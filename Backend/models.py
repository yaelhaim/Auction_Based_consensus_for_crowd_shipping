# app/models.py
# SQLAlchemy ORM models matching your PostgreSQL schema (UUID + ENUMs).

from __future__ import annotations

import uuid
from sqlalchemy import (
    Column,
    String,
    Integer,
    Numeric,
    Text,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Enum as SAEnum,
    ARRAY,  # for text[] columns
)
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.sql import func  # server_default / onupdate

# ------------------------------------------------------------------------------
# Base & ENUM types (names MUST match the PostgreSQL enum type names exactly)
# ------------------------------------------------------------------------------

Base = declarative_base()

user_role_enum          = SAEnum("sender", "driver", "admin", name="user_role")
request_type_enum       = SAEnum("passenger", "package", "ride", name="request_type")
request_status_enum     = SAEnum("open", "assigned", "in_transit", "completed", "cancelled", name="request_status")
bid_status_enum         = SAEnum("committed", "revealed", "won", "lost", "cancelled", name="bid_status")
assignment_status_enum  = SAEnum("created", "picked_up", "in_transit", "completed", "failed", "cancelled", name="assignment_status")
proof_type_enum         = SAEnum("photo", "signature", "note", name="proof_type")

# ------------------------------------------------------------------------------
# Users
# ------------------------------------------------------------------------------

class Users(Base):
    __tablename__ = "users"

    id              = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    wallet_address  = Column(String, unique=True, nullable=False)
    email           = Column(String, unique=True)          # nullable
    phone           = Column(String)                       # nullable
    role            = Column(user_role_enum, nullable=False)
    first_name      = Column(String)
    last_name       = Column(String)
    rating          = Column(Numeric)                      # 0..5
    city            = Column(Text)

    # Expo push (single-token model)
    expo_push_token       = Column(Text)                           # e.g. "ExponentPushToken[xxxx]"
    push_token_updated_at = Column(DateTime(timezone=True))

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    created_requests = relationship(
        "Requests",
        back_populates="owner",
        foreign_keys="Requests.owner_user_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    bids = relationship(
        "Bids",
        back_populates="bidder",
        foreign_keys="Bids.bidder_user_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    driver_assignments = relationship(
        "Assignments",
        back_populates="driver",
        foreign_keys="Assignments.driver_user_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    driver_offers = relationship(
        "CourierOffers",
        back_populates="driver",
        foreign_keys="CourierOffers.driver_user_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} role={self.role} rating={self.rating}>"

# ------------------------------------------------------------------------------
# Login nonces
# ------------------------------------------------------------------------------

class LoginNonces(Base):
    __tablename__ = "login_nonces"

    address     = Column(String, primary_key=True)  # PK is the address itself
    nonce       = Column(String, nullable=False)
    expires_at  = Column(DateTime(timezone=True), nullable=False)

# ------------------------------------------------------------------------------
# Requests (passenger / package / ride)
# ------------------------------------------------------------------------------

class Requests(Base):
    __tablename__ = "requests"

    id            = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    type         = Column(request_type_enum, nullable=False)   # passenger | package | ride
    from_address = Column(Text)
    from_lat     = Column(Numeric)     # nullable
    from_lon     = Column(Numeric)     # nullable
    to_address   = Column(Text)
    to_lat       = Column(Numeric)     # nullable
    to_lon       = Column(Numeric)     # nullable
    passengers   = Column(Integer, default=1)
    notes        = Column(Text)

    window_start = Column(DateTime(timezone=True))
    window_end   = Column(DateTime(timezone=True))

    status       = Column(request_status_enum, nullable=False)
    max_price    = Column(Numeric(10, 2))

    pickup_contact_name  = Column(String(100))
    pickup_contact_phone = Column(String(32))

    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    owner = relationship(
        "Users",
        back_populates="created_requests",
        foreign_keys=[owner_user_id],
    )
    bids = relationship(
        "Bids",
        back_populates="request",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    assignment = relationship(
        "Assignments",
        uselist=False,
        back_populates="request",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<Request id={self.id} type={self.type} status={self.status}>"

# ------------------------------------------------------------------------------
# Bids (commit → reveal)
# ------------------------------------------------------------------------------

class Bids(Base):
    __tablename__ = "bids"

    id             = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id     = Column(PG_UUID(as_uuid=True), ForeignKey("requests.id"), nullable=False)
    bidder_user_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    commitment_hash = Column(String)                 # commit phase
    revealed_amount = Column(Numeric(10, 2))         # reveal phase
    salt            = Column(String)                 # random salt for commit
    status          = Column(bid_status_enum, nullable=False)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    request = relationship(
        "Requests",
        back_populates="bids",
        foreign_keys=[request_id],
    )
    bidder = relationship(
        "Users",
        back_populates="bids",
        foreign_keys=[bidder_user_id],
    )

    def __repr__(self) -> str:
        return f"<Bid id={self.id} req={self.request_id} bidder={self.bidder_user_id} status={self.status}>"

# ------------------------------------------------------------------------------
# CourierOffers (drivers' availability & base price)
# ------------------------------------------------------------------------------

class CourierOffers(Base):
    __tablename__ = "courier_offers"

    id             = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_user_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    from_address   = Column(Text, nullable=False)
    to_address     = Column(Text)  # nullable
    window_start   = Column(DateTime(timezone=True), nullable=False)
    window_end     = Column(DateTime(timezone=True), nullable=False)

    min_price      = Column(Numeric(10, 2), nullable=False)
    types          = Column(ARRAY(String), nullable=False)  # e.g. ['package'] or ['package','passenger']

    notes          = Column(Text)
    status         = Column(String, nullable=False, default="active")  # 'active' / 'assigned' / 'cancelled'

    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    from_lat = Column(Numeric)
    from_lon = Column(Numeric)
    to_lat   = Column(Numeric)
    to_lon   = Column(Numeric)

    # Relationships
    driver = relationship(
        "Users",
        back_populates="driver_offers",
        foreign_keys=[driver_user_id],
    )

    def __repr__(self) -> str:
        return f"<CourierOffer id={self.id} driver={self.driver_user_id} status={self.status}>"

# ------------------------------------------------------------------------------
# Assignments (auction result)
# ------------------------------------------------------------------------------

class Assignments(Base):
    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("request_id", name="uq_assignments_request"),  # one active assignment per request
    )

    id             = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id     = Column(PG_UUID(as_uuid=True), ForeignKey("requests.id"), nullable=False)
    driver_user_id = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # assigned_at MUST NOT be NULL (DB had NOT NULL). Provide server_default.
    assigned_at    = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status         = Column(assignment_status_enum, nullable=False)

    onchain_tx_hash = Column(String)

    picked_up_at   = Column(DateTime(timezone=True))
    in_transit_at  = Column(DateTime(timezone=True))
    completed_at   = Column(DateTime(timezone=True))
    failed_at      = Column(DateTime(timezone=True))
    cancelled_at   = Column(DateTime(timezone=True))
    cancel_reason  = Column(Text)

    created_at     = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    request = relationship(
        "Requests",
        back_populates="assignment",
        foreign_keys=[request_id],
    )
    driver = relationship(
        "Users",
        back_populates="driver_assignments",
        foreign_keys=[driver_user_id],
    )
    escrow = relationship(
        "Escrows",
        uselist=False,
        back_populates="assignment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    proofs = relationship(
        "Proofs",
        back_populates="assignment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    ratings = relationship(
        "Ratings",
        back_populates="assignment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<Assignment id={self.id} req={self.request_id} driver={self.driver_user_id} status={self.status}>"

# ------------------------------------------------------------------------------
# Escrows
# ------------------------------------------------------------------------------

class Escrows(Base):
    __tablename__ = "escrows"
    __table_args__ = (
        UniqueConstraint("assignment_id", name="uq_escrows_assignment"),
    )

    id              = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id   = Column(PG_UUID(as_uuid=True), ForeignKey("assignments.id"), nullable=False)
    amount          = Column(Numeric(10, 2), nullable=False)
    deposit_tx_hash = Column(String)
    release_tx_hash = Column(String)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    assignment = relationship(
        "Assignments",
        back_populates="escrow",
        foreign_keys=[assignment_id],
    )

# ------------------------------------------------------------------------------
# Proofs (delivery proofs)
# ------------------------------------------------------------------------------

class Proofs(Base):
    __tablename__ = "proofs"

    id            = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id = Column(PG_UUID(as_uuid=True), ForeignKey("assignments.id"), nullable=False)
    type          = Column(proof_type_enum, nullable=False)  # photo | signature | note
    storage_url   = Column(Text, nullable=False)
    sha256_hex    = Column(String, nullable=False)

    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    assignment = relationship(
        "Assignments",
        back_populates="proofs",
        foreign_keys=[assignment_id],
    )

# ------------------------------------------------------------------------------
# Ratings
# ------------------------------------------------------------------------------

class Ratings(Base):
    __tablename__ = "ratings"

    id             = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rater_user_id  = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    ratee_user_id  = Column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    assignment_id  = Column(PG_UUID(as_uuid=True), ForeignKey("assignments.id"), nullable=False)
    score          = Column(Integer, nullable=False)      # 1..5
    comment        = Column(Text)

    created_at     = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    assignment = relationship(
        "Assignments",
        back_populates="ratings",
        foreign_keys=[assignment_id],
    )
    rater = relationship(
        "Users",
        foreign_keys=[rater_user_id],
    )
    ratee = relationship(
        "Users",
        foreign_keys=[ratee_user_id],
    )

    def __repr__(self) -> str:
        return f"<Rating id={self.id} score={self.score} rater={self.rater_user_id} ratee={self.ratee_user_id}>"

# ------------------------------------------------------------------------------
# Singular aliases (keep old imports working)
# ------------------------------------------------------------------------------

User = Users
LoginNonce = LoginNonces
Request = Requests
Bid = Bids
Assignment = Assignments
Escrow = Escrows
Proof = Proofs
Rating = Ratings
CourierOffer = CourierOffers

__all__ = [
    "Base",
    "Users", "LoginNonces", "Requests", "Bids", "CourierOffers", "Assignments", "Escrows", "Proofs", "Ratings",
    "User", "LoginNonce", "Request", "Bid", "CourierOffer", "Assignment", "Escrow", "Proof", "Rating",
    "user_role_enum", "request_type_enum", "request_status_enum",
    "bid_status_enum", "assignment_status_enum", "proof_type_enum",
]
