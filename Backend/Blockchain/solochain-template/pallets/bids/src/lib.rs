#![cfg_attr(not(feature = "std"), no_std)]

// Minimal on-chain market index bridging to your off-chain DB by UUID.
// We keep only IDs + essentials so nodes can reference the same items.

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::{pallet_prelude::*, BoundedVec};
    use frame_system::pallet_prelude::*;
    use scale_info::TypeInfo;

    // A compact 16-byte UUID (off-chain primary key mirror)
    pub type Uuid16 = [u8; 16];

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        #[pallet::constant] type MaxNotesLen: Get<u32>;
    }

    // Request “marker” on-chain (maps to requests table by uuid_16)
    #[derive(Encode, Decode, Clone, PartialEq, Eq, TypeInfo, MaxEncodedLen)]
    pub struct RequestMarker<AccountId> {
        pub uuid_16: Uuid16,         // maps to DB 'requests.id'
        pub owner: AccountId,        // maps to users.id (wallet owner)
        pub kind: u8,                // 0=package, 1=passenger (DB: type)
        pub max_price_cents: u32,    // NUMERIC(10,2) mirrored to cents for cheap checks
        pub window_start: u64,       // epoch millis or block number (your choice)
        pub window_end: u64,
        pub from_lat: i32,           // optional if you want on-chain distance checks
        pub from_lon: i32,
        pub to_lat: i32,
        pub to_lon: i32,
        pub notes: BoundedVec<u8, <T as Config>::MaxNotesLen>, // optional
    }

    // Courier offer “marker” on-chain (maps to courier_offers table by uuid_16)
    #[derive(Encode, Decode, Clone, PartialEq, Eq, TypeInfo, MaxEncodedLen)]
    pub struct OfferMarker<AccountId> {
        pub uuid_16: Uuid16,         // maps to DB 'courier_offers.id'
        pub courier: AccountId,      // driver_user_id
        pub min_price_cents: u32,    // DB: min_price NUMERIC to cents
        pub from_lat: i32,
        pub from_lon: i32,
        pub to_lat: i32,
        pub to_lon: i32,
        pub window_start: u64,
        pub window_end: u64,
        pub types_mask: u32,         // bitmask for supported types (package/passenger)
    }

    #[pallet::storage] pub type Requests<T: Config> =
        StorageMap<_, Blake2_128Concat, Uuid16, RequestMarker<T::AccountId>, OptionQuery>;

    #[pallet::storage] pub type Offers<T: Config> =
        StorageMap<_, Blake2_128Concat, Uuid16, OfferMarker<T::AccountId>, OptionQuery>;

    #[pallet::event]
    pub enum Event<T: Config> {
        RequestIndexed(Uuid16),
        OfferIndexed(Uuid16),
        RequestRemoved(Uuid16),
        OfferRemoved(Uuid16),
    }

    #[pallet::error]
    pub enum Error<T> {
        AlreadyExists,
        NotFound,
    }

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Index/announce a request UUID on-chain (created in your DB).
        /// Caller is typically the backend (FastAPI) using the request owner's account.
        #[pallet::weight(10_000)]
        pub fn index_request(
            origin: OriginFor<T>,
            uuid_16: Uuid16,
            kind: u8,
            max_price_cents: u32,
            window_start: u64, window_end: u64,
            from_lat: i32, from_lon: i32, to_lat: i32, to_lon: i32,
            notes: Vec<u8>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(Requests::<T>::get(uuid_16).is_none(), Error::<T>::AlreadyExists);
            let marker = RequestMarker::<T::AccountId> {
                uuid_16, owner: who, kind, max_price_cents,
                window_start, window_end, from_lat, from_lon, to_lat, to_lon,
                notes: BoundedVec::try_from(notes).unwrap_or_default(),
            };
            Requests::<T>::insert(uuid_16, marker);
            Self::deposit_event(Event::RequestIndexed(uuid_16));
            Ok(())
        }

        /// Index/announce a courier offer UUID on-chain (created in your DB).
        #[pallet::weight(10_000)]
        pub fn index_offer(
            origin: OriginFor<T>,
            uuid_16: Uuid16,
            min_price_cents: u32,
            from_lat: i32, from_lon: i32, to_lat: i32, to_lon: i32,
            window_start: u64, window_end: u64,
            types_mask: u32,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(Offers::<T>::get(uuid_16).is_none(), Error::<T>::AlreadyExists);
            let marker = OfferMarker::<T::AccountId> {
                uuid_16, courier: who, min_price_cents,
                from_lat, from_lon, to_lat, to_lon, window_start, window_end, types_mask,
            };
            Offers::<T>::insert(uuid_16, marker);
            Self::deposit_event(Event::OfferIndexed(uuid_16));
            Ok(())
        }

        /// Optional maintenance: remove markers when DB rows closed.
        #[pallet::weight(10_000)]
        pub fn remove_request(origin: OriginFor<T>, uuid_16: Uuid16) -> DispatchResult {
            let _who = ensure_signed(origin)?;
            ensure!(Requests::<T>::contains_key(uuid_16), Error::<T>::NotFound);
            Requests::<T>::remove(uuid_16);
            Self::deposit_event(Event::RequestRemoved(uuid_16));
            Ok(())
        }
        #[pallet::weight(10_000)]
        pub fn remove_offer(origin: OriginFor<T>, uuid_16: Uuid16) -> DispatchResult {
            let _who = ensure_signed(origin)?;
            ensure!(Offers::<T>::contains_key(uuid_16), Error::<T>::NotFound);
            Offers::<T>::remove(uuid_16);
            Self::deposit_event(Event::OfferRemoved(uuid_16));
            Ok(())
        }
    }
}
