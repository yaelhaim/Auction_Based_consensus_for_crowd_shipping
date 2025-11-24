# Backend/routes_escrow.py
# Escrow lifecycle endpoints.
# IMPORTANT:
# - /escrows/initiate is called ONLY when the user clicks "pay".
# - This endpoint:
#     1) Verifies assignment + permissions in the DB.
#     2) Creates (or reuses) an Escrow row in the DB.
#     3) Calls the on-chain `Escrow::create_escrow` extrinsic with:
#        (request_uuid, offer_uuid, driver, payer, amount).
# - The `EscrowCreated` event will be visible on-chain exactly when this
#   endpoint succeeds.

from __future__ import annotations

import os
import logging
from typing import Any, Optional
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from substrateinterface import SubstrateInterface, Keypair

from .Database.db import get_db
from .auth_dep import get_current_user
from .models import Assignment, Escrow, Request, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/escrows", tags=["escrows"])

# -------------------------- Substrate config --------------------------

SUBSTRATE_WS_URL = os.getenv("SUBSTRATE_WS_URL", "ws://127.0.0.1:9944")
SUBSTRATE_SIGNER_URI = os.getenv("SUBSTRATE_SIGNER_URI", "//Alice")

ESCROW_WAIT_FINALIZATION = os.getenv("ESCROW_WAIT_FINALIZATION", "0").lower() in (
    "1",
    "true",
    "yes",
)

# Optional fallback account when user has no wallet_address configured.
ESCROW_FALLBACK_ACCOUNT = os.getenv("ESCROW_FALLBACK_ACCOUNT", "")

_substrate: Optional[SubstrateInterface] = None
_signer: Optional[Keypair] = None


def get_substrate() -> SubstrateInterface:
    """
    Singleton-ish helper to reuse the Substrate WS connection.
    """
    global _substrate
    if _substrate is None:
        _substrate = SubstrateInterface(
            url=SUBSTRATE_WS_URL,
            ss58_format=42,
            type_registry_preset="substrate-node-template",
        )
        logger.info("[escrow] Connected to Substrate at %s", SUBSTRATE_WS_URL)
    return _substrate


def get_signer() -> Keypair:
    """
    Single backend signer used as origin for escrow extrinsics.
    NOTE:
      * Pallet `create_escrow` currently only requires `ensure_signed(origin)`,
        so the origin account is not strictly required to match payer/driver.
      * We still pass *real* payer/driver AccountIds as parameters.
    """
    global _signer
    if _signer is None:
        _signer = Keypair.create_from_uri(SUBSTRATE_SIGNER_URI)
        logger.info(
            "[escrow] Using signer URI %s (address=%s)",
            SUBSTRATE_SIGNER_URI,
            _signer.ss58_address,
        )
    return _signer


def _uuid16_from_any(val: Any) -> bytes:
    """
    Convert a Python UUID / string into 16-byte array for `[u8;16]` on-chain.
    Matches the representation used in the PoBA pallet.
    """
    if isinstance(val, UUID):
        u = val
    else:
        u = UUID(str(val))
    return u.bytes


# -------------------------- Helpers --------------------------

def _get_user_id(user: Any) -> str:
    """
    Extracts the authenticated user's ID from the dependency payload.
    Raises 401 if the ID is missing.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if isinstance(user, dict):
        uid = user.get("id") or user.get("user_id")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid user payload (no id)")
        return str(uid)
    uid = getattr(user, "id", None)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user payload (no id)")
    return str(uid)


def _get_wallet_address_for_user(db: Session, user_id: Any) -> str:
    """
    Load the on-chain wallet address for a given app user.
    Falls back to ESCROW_FALLBACK_ACCOUNT if not set.

    Assumes:
      * models.User has a `wallet_address` column (text).
    """
    user: Optional[User] = db.query(User).filter(User.id == user_id).first()
    if user and getattr(user, "wallet_address", None):
        return str(user.wallet_address)

    if ESCROW_FALLBACK_ACCOUNT:
        logger.warning(
            "[escrow] User %s has no wallet_address; using ESCROW_FALLBACK_ACCOUNT %s",
            user_id,
            ESCROW_FALLBACK_ACCOUNT,
        )
        return ESCROW_FALLBACK_ACCOUNT

    raise HTTPException(
        status_code=500,
        detail="User has no wallet_address configured and ESCROW_FALLBACK_ACCOUNT is not set",
    )


# -------------------------- Schemas --------------------------

class EscrowInitiateIn(BaseModel):
    assignment_id: str


class EscrowOut(BaseModel):
    id: str
    assignment_id: str
    payer_user_id: str
    payee_user_id: str
    amount_cents: int
    status: str
    created_at: datetime
    updated_at: datetime


# -------------------------- On-chain helper --------------------------

def _create_onchain_escrow_for_assignment(
    db: Session,
    asg: Assignment,
    req: Request,
    amount_cents: int,
) -> None:
    """
    Compose and submit the `Escrow::create_escrow` extrinsic.

    Mapping:
      request_uuid -> req.id (DB UUID)
      offer_uuid   -> asg.offer_id (DB UUID, FK to courier_offers)
      driver       -> driver's wallet_address
      payer        -> request owner's wallet_address
      amount       -> amount_cents (1 chain unit = 1 cent for now)

    If submission fails, this function raises an exception and the caller
    should roll back the DB transaction.
    """
    # We expect Assignment to carry the related offer UUID.
    offer_id = getattr(asg, "offer_id", None)
    if not offer_id:
        raise HTTPException(
            status_code=500,
            detail="Assignment has no offer_id; cannot create on-chain escrow",
        )

    request_uuid_bytes = _uuid16_from_any(req.id)
    offer_uuid_bytes = _uuid16_from_any(offer_id)

    # Resolve on-chain AccountIds for driver and payer.
    driver_address = _get_wallet_address_for_user(db, asg.driver_user_id)
    payer_address = _get_wallet_address_for_user(db, req.owner_user_id)

    substrate = get_substrate()
    signer = get_signer()

    call = substrate.compose_call(
        call_module="Escrow",
        call_function="create_escrow",
        call_params={
            "request_uuid": request_uuid_bytes,
            "offer_uuid": offer_uuid_bytes,
            "driver": driver_address,
            "payer": payer_address,
            "amount": amount_cents,
        },
    )

    extrinsic = substrate.create_signed_extrinsic(call=call, keypair=signer)

    wait_args = {}
    if ESCROW_WAIT_FINALIZATION:
        wait_args["wait_for_finalization"] = True
    else:
        wait_args["wait_for_inclusion"] = True

    try:
        receipt = substrate.submit_extrinsic(extrinsic, **wait_args)
    except Exception as e:
        logger.exception("[escrow] submit_extrinsic(create_escrow) failed")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to submit create_escrow extrinsic: {e}",
        )

    if not getattr(receipt, "is_success", False):
        logger.error(
            "[escrow] create_escrow extrinsic failed: %s",
            getattr(receipt, "error_message", None),
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"create_escrow extrinsic failed: "
                f"{getattr(receipt, 'error_message', 'unknown error')}"
            ),
        )

    logger.info(
        "[escrow] create_escrow OK (hash=%s, amount_cents=%s)",
        getattr(receipt, "extrinsic_hash", None),
        amount_cents,
    )


# -------------------------- Routes --------------------------

@router.post("/initiate", response_model=EscrowOut, status_code=status.HTTP_201_CREATED)
def initiate_escrow(
    payload: EscrowInitiateIn,
    db: Session = Depends(get_db),
    user: Any = Depends(get_current_user),
):
    """
    Create (or return existing) escrow for an assignment AND call the
    on-chain Escrow::create_escrow extrinsic.

    Flow:
      1) Only the request owner (payer) may call this endpoint.
      2) Assignment must exist and have a positive agreed_price_cents.
      3) If an Escrow already exists and assignment is in a later payment
         stage, we simply return the existing row (idempotent).
      4) Otherwise:
           * Create a new Escrow row with status=pending_deposit.
           * Set assignment.payment_status=pending_deposit.
           * Call on-chain `create_escrow`.
           * Commit the DB transaction only if the extrinsic succeeds.

    When this endpoint succeeds, you should see `EscrowCreated` event
    in the chain explorer for the same (request_uuid, offer_uuid).
    """
    uid = _get_user_id(user)

    # 1) Load assignment + request
    asg: Optional[Assignment] = (
        db.query(Assignment)
        .filter(Assignment.id == payload.assignment_id)
        .first()
    )
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")

    req: Optional[Request] = (
        db.query(Request)
        .filter(Request.id == asg.request_id)
        .first()
    )
    if not req:
        raise HTTPException(
            status_code=500,
            detail="Request row missing for assignment",
        )

    # 2) Ensure caller is the payer (request owner)
    if str(req.owner_user_id) != str(uid):
        raise HTTPException(
            status_code=403,
            detail="Only the request owner can initiate payment for this assignment",
        )

    # 3) Validate agreed price
    if asg.agreed_price_cents is None or int(asg.agreed_price_cents) <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Assignment has no positive agreed_price_cents; "
                "cannot create escrow"
            ),
        )
    amount_cents = int(asg.agreed_price_cents)

    # 4) Validate payment status allowed to start (simple state gate)
    allowed_start_status = {"pending_deposit", "failed", "refunded", "cancelled"}
    ps = str(getattr(asg, "payment_status", "pending_deposit"))

    # If there is already an Escrow AND we are already in a later stage,
    # return existing escrow (idempotent behaviour).
    if asg.escrow is not None and ps not in allowed_start_status:
        e = asg.escrow
        return EscrowOut(
            id=str(e.id),
            assignment_id=str(e.assignment_id),
            payer_user_id=str(e.payer_user_id),
            payee_user_id=str(e.payee_user_id),
            amount_cents=int(e.amount_cents),
            status=str(e.status),
            created_at=e.created_at or datetime.now(timezone.utc),
            updated_at=e.updated_at or datetime.now(timezone.utc),
        )

    # 5) If escrow already exists but we are allowed to (re)start, just reuse it
    #    and DO NOT call on-chain again (we assume it was already done).
    if asg.escrow is not None and ps in allowed_start_status:
        e = asg.escrow
        return EscrowOut(
            id=str(e.id),
            assignment_id=str(e.assignment_id),
            payer_user_id=str(e.payer_user_id),
            payee_user_id=str(e.payee_user_id),
            amount_cents=int(e.amount_cents),
            status=str(e.status),
            created_at=e.created_at or datetime.now(timezone.utc),
            updated_at=e.updated_at or datetime.now(timezone.utc),
        )

    # 6) Create a new Escrow row + align assignment.payment_status,
    #    but DO NOT commit yet – we commit only after the extrinsic succeeds.
    e = Escrow(
        assignment_id=asg.id,
        payer_user_id=req.owner_user_id,
        payee_user_id=asg.driver_user_id,
        amount_cents=amount_cents,
        status="pending_deposit",
    )
    db.add(e)
    asg.payment_status = "pending_deposit"

    try:
        # 7) Call on-chain escrow creation.
        _create_onchain_escrow_for_assignment(db, asg, req, amount_cents)

        # 8) Commit DB transaction only if chain part succeeded.
        db.commit()
    except HTTPException:
        # Roll back DB if on-chain call failed.
        db.rollback()
        raise
    except Exception as e_generic:
        db.rollback()
        logger.exception("[escrow] Unexpected error in initiate_escrow")
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error in initiate_escrow: {e_generic}",
        )

    # 9) Refresh and return
    db.refresh(e)
    db.refresh(asg)

    return EscrowOut(
        id=str(e.id),
        assignment_id=str(e.assignment_id),
        payer_user_id=str(e.payer_user_id),
        payee_user_id=str(e.payee_user_id),
        amount_cents=int(e.amount_cents),
        status=str(e.status),
        created_at=e.created_at or datetime.now(timezone.utc),
        updated_at=e.updated_at or datetime.now(timezone.utc),
    )
