#![cfg_attr(not(feature = "std"), no_std)]

// PoBA pallet: nodes submit proposals for a given slot, block author finalizes winner.
// We keep only IDs and scores; no heavy computation on-chain.

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::{pallet_prelude::*, traits::Get};
    use frame_system::pallet_prelude::*;
    use scale_info::TypeInfo;

    pub type Uuid16 = [u8; 16];

    #[derive(Encode, Decode, Clone, PartialEq, Eq, TypeInfo, MaxEncodedLen)]
    pub struct Match {
        pub request_uuid: Uuid16,   // maps to DB requests.id
        pub offer_uuid:   Uuid16,   // maps to DB courier_offers.id
        pub agreed_price_cents: u32,
        pub partial_score: i64,
    }

    #[derive(Encode, Decode, Clone, PartialEq, Eq, TypeInfo, MaxEncodedLen)]
    pub struct Proposal<AccountId> {
        pub slot: u64,
        pub proposer: AccountId,
        pub total_score: i64,
        pub matches: Vec<Match>,
    }

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        #[pallet::constant] type MaxMatchesPerProposal: Get<u32>;
    }

    #[pallet::storage]
    pub type BestBySlot<T: Config> =
        StorageMap<_, Blake2_128Concat, u64, Proposal<T::AccountId>, OptionQuery>;

    #[pallet::storage]
    pub type FinalizedBySlot<T: Config> =
        StorageMap<_, Blake2_128Concat, u64, Proposal<T::AccountId>, OptionQuery>;

    #[pallet::event]
    pub enum Event<T: Config> {
        ProposalSubmitted(u64 /*slot*/, i64 /*score*/),
        SlotFinalized(u64 /*slot*/, i64 /*score*/),
    }

    #[pallet::error]
    pub enum Error<T> {
        SlotAlreadyFinalized,
        TooManyMatches,
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        #[pallet::weight(10_000 + (matches.len() as u64)*1_000)]
        pub fn submit_proposal(
            origin: OriginFor<T>,
            slot: u64,
            total_score: i64,
            matches: Vec<Match>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!((matches.len() as u32) <= T::MaxMatchesPerProposal::get(), Error::<T>::TooManyMatches);

            if let Some(cur) = BestBySlot::<T>::get(slot) {
                if total_score <= cur.total_score {
                    Self::deposit_event(Event::ProposalSubmitted(slot, total_score));
                    return Ok(())
                }
            }
            let p = Proposal::<T::AccountId> { slot, proposer: who, total_score, matches };
            BestBySlot::<T>::insert(slot, &p);
            Self::deposit_event(Event::ProposalSubmitted(slot, p.total_score));
            Ok(())
        }

        #[pallet::weight(10_000)]
        pub fn finalize_slot(origin: OriginFor<T>, slot: u64) -> DispatchResult {
            let _who = ensure_signed(origin)?;
            ensure!(FinalizedBySlot::<T>::get(slot).is_none(), Error::<T>::SlotAlreadyFinalized);
            if let Some(best) = BestBySlot::<T>::take(slot) {
                FinalizedBySlot::<T>::insert(slot, &best);
                Self::deposit_event(Event::SlotFinalized(slot, best.total_score));
            }
            Ok(())
        }
    }
}
