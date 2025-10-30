#![cfg_attr(not(feature = "std"), no_std)]

// --------------------------- Imports & Prelude ---------------------------
use codec::{Decode, Encode, MaxEncodedLen};
use frame_support::{pallet_prelude::*, BoundedVec};
use frame_system::pallet_prelude::*;
use scale_info::TypeInfo;
use sp_runtime::RuntimeDebug;
use sp_std::vec::Vec;

// --------------------------- Domain Types ---------------------------

/// A single matched pair (request ↔ offer) with a score contribution.
/// Stored on-chain inside a bounded vector (not passed directly in the call).
#[derive(Clone, PartialEq, Eq, Encode, Decode, MaxEncodedLen, TypeInfo, RuntimeDebug)]
pub struct Match {
    pub request_uuid: [u8; 16],
    pub offer_uuid:   [u8; 16],
    pub agreed_price_cents: u32,
    pub partial_score: i64,
}

/// Upper bound on how many matches a single proposal may include.
pub const MAX_MATCHES_PER_PROPOSAL: u32 = 256;
pub type MatchesBounded = BoundedVec<Match, ConstU32<MAX_MATCHES_PER_PROPOSAL>>;

/// A full proposal as stored on-chain for a given slot.
#[derive(Clone, PartialEq, Eq, Encode, Decode, MaxEncodedLen, TypeInfo, RuntimeDebug)]
pub struct Proposal {
    pub total_score: i64,
    pub matches:     MatchesBounded,
}

// ------------------------------ Pallet ------------------------------

#[frame_support::pallet]
pub mod pallet {
    use super::*;

    // -------- Config --------
    #[pallet::config]
    pub trait Config: frame_system::Config {
        /// Pallet events.
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
    }

    /// The pallet type.
    #[pallet::pallet]
    pub struct Pallet<T>(_);

    // -------- Storage --------

    /// For each slot, keep the *best* proposal seen so far (by total_score).
    #[pallet::storage]
    #[pallet::getter(fn best_proposal)]
    pub type BestProposal<T: Config> =
        StorageMap<_, Blake2_128Concat, u64 /*slot*/, Proposal, OptionQuery>;

    // -------- Events --------

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// A proposal was submitted for `slot` with `total_score`.
        ProposalSubmitted(u64, i64),
        /// The slot was finalized with the winning `total_score`.
        SlotFinalized(u64, i64),
    }

    // -------- Errors --------

    #[pallet::error]
    pub enum Error<T> {
        /// Submitted proposal has more matches than allowed by the bound.
        TooManyMatches,
        /// No proposal exists for the given slot.
        NoProposalForSlot,
    }

    // -------- Calls --------

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Submit (or improve) the best proposal for a given slot.
        ///
        /// NOTE: To satisfy FRAME's `DecodeWithMemTracking` requirement on call parameters,
        /// we accept `Vec` of tuples (which implement the required traits),
        /// and convert them to `Match` + `BoundedVec` inside.
        #[pallet::weight(10_000)]
        pub fn submit_proposal(
            origin: OriginFor<T>,
            slot: u64,
            total_score: i64,
            // (request_uuid, offer_uuid, agreed_price_cents, partial_score)
            matches: Vec<([u8; 16], [u8; 16], u32, i64)>,
        ) -> DispatchResult {
            let _who = ensure_signed(origin)?;

            // Convert tuples → Match → BoundedVec
            let mut tmp: Vec<Match> = Vec::with_capacity(matches.len());
            for (rq, of, price, part) in matches.into_iter() {
                tmp.push(Match {
                    request_uuid: rq,
                    offer_uuid: of,
                    agreed_price_cents: price,
                    partial_score: part,
                });
            }
            let bounded: MatchesBounded =
                BoundedVec::try_from(tmp).map_err(|_| Error::<T>::TooManyMatches)?;

            match BestProposal::<T>::get(slot) {
                Some(existing) => {
                    if total_score > existing.total_score {
                        let new_best = Proposal { total_score, matches: bounded };
                        BestProposal::<T>::insert(slot, new_best);
                        Self::deposit_event(Event::ProposalSubmitted(slot, total_score));
                    }
                }
                None => {
                    let new_best = Proposal { total_score, matches: bounded };
                    BestProposal::<T>::insert(slot, new_best);
                    Self::deposit_event(Event::ProposalSubmitted(slot, total_score));
                }
            }

            Ok(())
        }

        /// Finalize a slot: read the best proposal and emit `SlotFinalized`.
        /// (MVP) Only emits an event.
        #[pallet::weight(10_000)]
        pub fn finalize_slot(origin: OriginFor<T>, slot: u64) -> DispatchResult {
            let _who = ensure_signed(origin)?;
            let best = BestProposal::<T>::get(slot).ok_or(Error::<T>::NoProposalForSlot)?;
            Self::deposit_event(Event::SlotFinalized(slot, best.total_score));
            Ok(())
        }
    }
}

// Re-export the pallet items so `impl pallet_poba::Config for Runtime` works.
pub use pallet::*;
