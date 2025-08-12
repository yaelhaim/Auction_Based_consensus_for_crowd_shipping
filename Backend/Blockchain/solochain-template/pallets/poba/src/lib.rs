#![cfg_attr(not(feature = "std"), no_std)]
pub use pallet::*;

// Use `alloc::vec::Vec` to avoid depending on `sp-std` in Cargo.toml
extern crate alloc;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::{pallet_prelude::*, dispatch::DispatchResult, BoundedVec};
    use frame_system::pallet_prelude::*;
    use alloc::vec::Vec; // <-- use alloc Vec

    // --- Constants ---
    /// Maximum allowed length for details_uri in bytes.
    type MaxDetailsUriLen = ConstU32<256>;

    // --- Types ---
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
        pub winning_bid: Option<u128>,
    }

    // --- Pallet Declaration ---
    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
    }

    // --- Storage ---
    /// Stores the ID for the next shipment.
    #[pallet::storage]
    pub type NextShipmentId<T: Config> = StorageValue<_, u64, ValueQuery>;

    /// Stores all shipments by their ID.
    #[pallet::storage]
    pub type Shipments<T: Config> =
        StorageMap<_, Blake2_128Concat, u64, Shipment<T::AccountId>, OptionQuery>;

    // --- Events ---
    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        ShipmentCreated { id: u64, creator: T::AccountId, deadline: u64 },
    }

    // --- Errors ---
    #[pallet::error]
    pub enum Error<T> {
        /// The provided details URI exceeds the maximum allowed length.
        DetailsUriTooLong,
        /// The provided deadline must be greater than zero.
        DeadlineMustBePositive,
    }

    // --- Calls ---
    #[pallet::call]
    impl<T: Config> Pallet<T> {

        /// Creates a new shipment with the given details URI and deadline.
        /// The details URI is stored as a bounded vector to ensure encoded length limit.
        #[pallet::call_index(0)]
        #[pallet::weight(10_000)] // TODO: Replace with benchmarked weight
        pub fn create_shipment(
            origin: OriginFor<T>,
            details_uri: Vec<u8>, // Incoming unbounded Vec
            deadline: u64
        ) -> DispatchResult {
            // Ensure the caller is signed
            let who = ensure_signed(origin)?;

            // Ensure the deadline is positive
            ensure!(deadline > 0, Error::<T>::DeadlineMustBePositive);

            // Convert to BoundedVec, fail if exceeds MaxDetailsUriLen
            let details_uri: BoundedVec<u8, MaxDetailsUriLen> =
                details_uri.try_into().map_err(|_| Error::<T>::DetailsUriTooLong)?;

            // Get current shipment ID
            let id = NextShipmentId::<T>::get();

            // Insert shipment into storage
            Shipments::<T>::insert(
                id,
                Shipment {
                    creator: who.clone(),
                    details_uri,
                    deadline,
                    state: AuctionState::Open,
                    winner: None,
                    winning_bid: None,
                }
            );

            // Increment shipment ID for next creation
            NextShipmentId::<T>::put(id.saturating_add(1));

            // Emit event
            Self::deposit_event(Event::ShipmentCreated { id, creator: who, deadline });

            Ok(())
        }
    }
}
