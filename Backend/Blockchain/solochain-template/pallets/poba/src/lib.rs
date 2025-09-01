#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

// Use `alloc::vec::Vec` to avoid depending on `sp-std` in Cargo.toml
extern crate alloc;

#[frame_support::pallet]
pub mod pallet {
    use alloc::vec::Vec;
    use frame_support::{pallet_prelude::*, BoundedVec};
    use frame_system::pallet_prelude::*;

    // ---- Constants ----
    /// Maximum allowed length for details_uri in bytes.
    type MaxDetailsUriLen = ConstU32<256>;

    // ---- Types ----
    #[derive(Clone, Encode, Decode, TypeInfo, MaxEncodedLen, PartialEq, Eq, RuntimeDebug)]
    pub enum AuctionState {
        Open,
        Closed,
        Declared,
    }

    #[derive(Clone, Encode, Decode, TypeInfo, MaxEncodedLen, PartialEq, Eq, RuntimeDebug)]
    pub struct Shipment<AccountId> {
        pub creator: AccountId,
        pub details_uri: BoundedVec<u8, MaxDetailsUriLen>,
        pub deadline: u64,
        pub state: AuctionState,
        pub winner: Option<AccountId>,
        pub winning_bid: Option<u128>, // keep None for now unless you store a price
    }

    // ---- Pallet declaration ----
    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
    }

    // ---- Storage ----
    /// Next shipment ID (auto-increment).
    #[pallet::storage]
    pub type NextShipmentId<T: Config> = StorageValue<_, u64, ValueQuery>;

    /// All shipments by ID.
    #[pallet::storage]
    pub type Shipments<T: Config> =
        StorageMap<_, Blake2_128Concat, u64, Shipment<T::AccountId>, OptionQuery>;

    // ---- Events ----
    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Emitted when a shipment is created.
        ShipmentCreated { id: u64, creator: T::AccountId, deadline: u64 },

        /// Emitted when an auction is finalized on-chain.
        AuctionFinalized { auction_id: u64, winner: T::AccountId, target_slot: u64 },
    }

    // ---- Errors ----
    #[pallet::error]
    pub enum Error<T> {
        /// The provided details URI exceeds the maximum allowed length.
        DetailsUriTooLong,
        /// The provided deadline must be greater than zero.
        DeadlineMustBePositive,
        /// Auction not found.
        AuctionNotFound,
        /// Auction already closed.
        AuctionAlreadyClosed,
        /// No winner stored yet (if you decide to require it).
        NoWinnerYet,
    }

    // ---- Calls ----
    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Create a new shipment (opens an auction).
        #[pallet::call_index(0)]
        #[pallet::weight(10_000)] // TODO: Replace with benchmarked weight
        pub fn create_shipment(
            origin: OriginFor<T>,
            details_uri: Vec<u8>,
            deadline: u64,
        ) -> DispatchResult {
            // Must be a signed caller
            let who = ensure_signed(origin)?;
            // Basic validation
            ensure!(deadline > 0, Error::<T>::DeadlineMustBePositive);

            // Convert to BoundedVec (enforce max length)
            let details_uri: BoundedVec<u8, MaxDetailsUriLen> =
                details_uri.try_into().map_err(|_| Error::<T>::DetailsUriTooLong)?;

            // Allocate ID
            let id = NextShipmentId::<T>::get();

            // Persist
            Shipments::<T>::insert(
                id,
                Shipment {
                    creator: who.clone(),
                    details_uri,
                    deadline,
                    state: AuctionState::Open,
                    winner: None,
                    winning_bid: None,
                },
            );

            // Bump next ID
            NextShipmentId::<T>::put(id.saturating_add(1));

            // Emit event
            Self::deposit_event(Event::ShipmentCreated { id, creator: who, deadline });

            Ok(())
        }

        /// Finalize auction: declare the winner and close it.
        /// The `winner` and `target_slot` come from your off-chain scheduler (APScheduler).
        #[pallet::call_index(1)]
        #[pallet::weight(10_000)] // TODO: Replace with benchmarked weight
        pub fn finalize_auction(
            origin: OriginFor<T>,
            auction_id: u64,
            winner: T::AccountId,
            target_slot: u64,
        ) -> DispatchResult {
            // Decide policy: signed or root. For MVP we allow any signed (server key).
            let _who = ensure_signed(origin)?;
            // Or: ensure_root(origin)?;

            // Load auction
            let mut s = Shipments::<T>::get(auction_id).ok_or(Error::<T>::AuctionNotFound)?;
            ensure!(s.state == AuctionState::Open, Error::<T>::AuctionAlreadyClosed);

            // Update winner and close. Do NOT misuse target_slot as a price.
            s.state = AuctionState::Closed;
            s.winner = Some(winner.clone());
            // keep s.winning_bid as-is (None) unless you have a price to store.

            Shipments::<T>::insert(auction_id, s);

            // Emit event with the slot used to align Aura authoring.
            Self::deposit_event(Event::AuctionFinalized {
                auction_id,
                winner,
                target_slot,
            });

            Ok(())
        }
    }
}
