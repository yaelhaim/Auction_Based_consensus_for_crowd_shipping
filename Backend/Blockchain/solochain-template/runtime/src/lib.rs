#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(feature = "std")]
include!(concat!(env!("OUT_DIR"), "/wasm_binary.rs"));

pub mod apis;
#[cfg(feature = "runtime-benchmarks")]
mod benchmarks;
pub mod configs;
pub mod genesis_config_presets;

extern crate alloc;
use alloc::vec::Vec;

use frame_support::construct_runtime;
use sp_runtime::{
    generic, impl_opaque_keys,
    traits::{BlakeTwo256, IdentifyAccount, Verify},
    MultiAddress, MultiSignature,
};
#[cfg(feature = "std")]
use sp_version::NativeVersion;
use sp_version::RuntimeVersion;

// --------------------- Opaque types (CLI/light clients) ---------------------
pub mod opaque {
    use super::*;
    use sp_runtime::{
        generic,
        traits::{BlakeTwo256, Hash as HashT},
    };

    pub use sp_runtime::OpaqueExtrinsic as UncheckedExtrinsic;

    /// Opaque types for light clients / CLI.
    pub type Header = generic::Header<super::BlockNumber, BlakeTwo256>;
    pub type Block = generic::Block<Header, UncheckedExtrinsic>;
    pub type BlockId = generic::BlockId<Block>;
    pub type Hash = <BlakeTwo256 as HashT>::Output;
}

impl_opaque_keys! {
    pub struct SessionKeys {
        pub aura: Aura,
        pub grandpa: Grandpa,
    }
}

// --------------------------- Runtime versioning -----------------------------
#[sp_version::runtime_version]
pub const VERSION: RuntimeVersion = RuntimeVersion {
    spec_name: alloc::borrow::Cow::Borrowed("solochain-template-runtime"),
    impl_name: alloc::borrow::Cow::Borrowed("solochain-template-runtime"),
    authoring_version: 1,
    spec_version: 101,
    impl_version: 1,
    apis: apis::RUNTIME_API_VERSIONS,
    transaction_version: 1,
    system_version: 1,
};

// ----------------------------- Block time (6s) ------------------------------
mod block_times {
    /// Target/expected block time (~6s).
    pub const MILLI_SECS_PER_BLOCK: u64 = 6000;
    /// Picked up by pallet_timestamp and then Aura.
    pub const SLOT_DURATION: u64 = MILLI_SECS_PER_BLOCK;
}
pub use block_times::*;

// ------------------------------- Time units --------------------------------
pub type BlockNumber = u32;
pub const MINUTES: BlockNumber = 60_000 / (MILLI_SECS_PER_BLOCK as BlockNumber);
pub const HOURS: BlockNumber = MINUTES * 60;
pub const DAYS: BlockNumber = HOURS * 24;

// ------------------------------ Misc constants ------------------------------
pub const BLOCK_HASH_COUNT: BlockNumber = 2400;

// Balances units
pub type Balance = u128;
pub const UNIT: Balance = 1_000_000_000_000;
pub const MILLI_UNIT: Balance = 1_000_000_000;
pub const MICRO_UNIT: Balance = 1_000_000;

/// Existential deposit.
pub const EXISTENTIAL_DEPOSIT: Balance = MILLI_UNIT;

// ------------------------------- Account / Extrinsic types ------------------
#[cfg(feature = "std")]
pub fn native_version() -> NativeVersion {
    NativeVersion { runtime_version: VERSION, can_author_with: Default::default() }
}

pub type Signature = MultiSignature;
pub type AccountId = <<Signature as Verify>::Signer as IdentifyAccount>::AccountId;
pub type Nonce = u32;
pub type Hash = sp_core::H256;
pub type Address = MultiAddress<AccountId, ()>;
pub type Header = generic::Header<BlockNumber, BlakeTwo256>;

// ------------------------------ Compose runtime -----------------------------
construct_runtime!(
    pub enum Runtime {
        System: frame_system,
        Timestamp: pallet_timestamp,
        Aura: pallet_aura,
        Grandpa: pallet_grandpa,
        Balances: pallet_balances,
        TransactionPayment: pallet_transaction_payment,
        Sudo: pallet_sudo,

        // Optional example pallet
        Template: pallet_template,

        // Our PoBA pallet
        PoBA: pallet_poba,
    }
);

// ✅ Re-export Call aliases expected by node-side code (benchmarking, etc.)
pub use frame_system::Call as SystemCall;
pub use pallet_balances::Call as BalancesCall;

// ------------------------ Signed extensions / extrinsics --------------------
// NOTE: These depend on `Runtime` so we place them *after* construct_runtime!.
pub type TxExtension = (
    frame_system::CheckNonZeroSender<Runtime>,
    frame_system::CheckSpecVersion<Runtime>,
    frame_system::CheckTxVersion<Runtime>,
    frame_system::CheckGenesis<Runtime>,
    frame_system::CheckEra<Runtime>,
    frame_system::CheckNonce<Runtime>,
    frame_system::CheckWeight<Runtime>,
    pallet_transaction_payment::ChargeTransactionPayment<Runtime>,
    frame_metadata_hash_extension::CheckMetadataHash<Runtime>,
    frame_system::WeightReclaim<Runtime>,
);

pub type UncheckedExtrinsic =
    generic::UncheckedExtrinsic<Address, RuntimeCall, Signature, TxExtension>;

pub type Block = generic::Block<Header, UncheckedExtrinsic>;
pub type SignedBlock = generic::SignedBlock<Block>;
pub type BlockId = generic::BlockId<Block>;

#[allow(unused_parens)]
type Migrations = ();

pub type Executive = frame_executive::Executive<
    Runtime,
    Block,
    frame_system::ChainContext<Runtime>,
    Runtime,
    AllPalletsWithSystem,
    Migrations,
>;

// ----------------------------- PoBA pallet Config ---------------------------
impl pallet_poba::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
}
