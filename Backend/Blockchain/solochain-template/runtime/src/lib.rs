#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(feature = "std")]
include!(concat!(env!("OUT_DIR"), "/wasm_binary.rs"));

pub mod apis;
#[cfg(feature = "runtime-benchmarks")]
mod benchmarks;
pub mod configs;

extern crate alloc;
use alloc::vec::Vec;

use sp_runtime::{
    generic, impl_opaque_keys,
    traits::{BlakeTwo256, IdentifyAccount, Verify},
    MultiAddress, MultiSignature,
};
#[cfg(feature = "std")]
use sp_version::NativeVersion;
use sp_version::RuntimeVersion;

pub use frame_system::Call as SystemCall;
pub use pallet_balances::Call as BalancesCall;
pub use pallet_timestamp::Call as TimestampCall;
#[cfg(any(feature = "std", test))]
pub use sp_runtime::BuildStorage;

pub mod genesis_config_presets;
pub use pallet_poba;

// --------------------- Opaque types (CLI/light clients) ---------------------
pub mod opaque {
    use super::*;
    use sp_runtime::{
        generic,
        traits::{BlakeTwo256, Hash as HashT},
    };

    pub use sp_runtime::OpaqueExtrinsic as UncheckedExtrinsic;

    /// Opaque block header type.
    pub type Header = generic::Header<BlockNumber, BlakeTwo256>;
    /// Opaque block type.
    pub type Block = generic::Block<Header, UncheckedExtrinsic>;
    /// Opaque block identifier type.
    pub type BlockId = generic::BlockId<Block>;
    /// Opaque block hash type.
    pub type Hash = <BlakeTwo256 as HashT>::Output;
}

impl_opaque_keys! {
    pub struct SessionKeys {
        pub aura: Aura,
        pub grandpa: Grandpa,
    }
}

// --------------------------- PoBA pallet Config -----------------------------
impl pallet_poba::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
}

// --------------------------- Runtime versioning -----------------------------
#[sp_version::runtime_version]
pub const VERSION: RuntimeVersion = RuntimeVersion {
    spec_name: alloc::borrow::Cow::Borrowed("solochain-template-runtime"),
    impl_name: alloc::borrow::Cow::Borrowed("solochain-template-runtime"),
    authoring_version: 1,
    // NOTE: bump spec_version when you change any runtime behavior or constants.
    spec_version: 101, // ← העליתי מ-100 כדי לסמן שינוי זמן הבלוק
    impl_version: 1,
    apis: apis::RUNTIME_API_VERSIONS,
    transaction_version: 1,
    system_version: 1,
};

// ----------------------------- Block time (6s) ------------------------------
mod block_times {
    /// Target/expected block time.
    ///
    /// We target 6000ms (~6s) per block. `SLOT_DURATION` is picked up by
    /// `pallet_timestamp` and in turn by `pallet_aura`.
    pub const MILLI_SECS_PER_BLOCK: u64 = 6000;

    // NOTE: Can't change slot duration on a live chain. Changing this requires a new chain state.
    pub const SLOT_DURATION: u64 = MILLI_SECS_PER_BLOCK;
}
pub use block_times::*;

// ------------------------------- Time units --------------------------------
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

// ------------------------------- Type aliases -------------------------------
#[cfg(feature = "std")]
pub fn native_version() -> NativeVersion {
    NativeVersion { runtime_version: VERSION, can_author_with: Default::default() }
}

/// Signature over transactions.
pub type Signature = MultiSignature;
/// Account identifier (derived from the public key).
pub type AccountId = <<Signature as Verify>::Signer as IdentifyAccount>::AccountId;
/// Nonce type.
pub type Nonce = u32;
/// Hash type.
pub type Hash = sp_core::H256;
/// Block number type.
pub type BlockNumber = u32;
/// Address format.
pub type Address = MultiAddress<AccountId, ()>;
/// Header and Block types.
pub type Header = generic::Header<BlockNumber, BlakeTwo256>;
pub type Block = generic::Block<Header, UncheckedExtrinsic>;
pub type SignedBlock = generic::SignedBlock<Block>;
pub type BlockId = generic::BlockId<Block>;

/// Transaction extension tuple (signed extras).
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

/// Unchecked extrinsic type.
pub type UncheckedExtrinsic =
    generic::UncheckedExtrinsic<Address, RuntimeCall, Signature, TxExtension>;

/// The payload being signed in transactions.
pub type SignedPayload = generic::SignedPayload<RuntimeCall, TxExtension>;

/// Runtime-wide migrations (if any).
#[allow(unused_parens)]
type Migrations = ();

/// Executive dispatches calls to pallets.
pub type Executive = frame_executive::Executive<
    Runtime,
    Block,
    frame_system::ChainContext<Runtime>,
    Runtime,
    AllPalletsWithSystem,
    Migrations,
>;

// ------------------------------ Compose runtime -----------------------------
#[frame_support::runtime]
mod runtime {
    #[runtime::runtime]
    #[runtime::derive(
        RuntimeCall,
        RuntimeEvent,
        RuntimeError,
        RuntimeOrigin,
        RuntimeFreezeReason,
        RuntimeHoldReason,
        RuntimeSlashReason,
        RuntimeLockId,
        RuntimeTask,
        RuntimeViewFunction
    )]
    pub struct Runtime;

    #[runtime::pallet_index(0)]
    pub type System = frame_system;

    #[runtime::pallet_index(1)]
    pub type Timestamp = pallet_timestamp;

    #[runtime::pallet_index(2)]
    pub type Aura = pallet_aura;

    #[runtime::pallet_index(3)]
    pub type Grandpa = pallet_grandpa;

    #[runtime::pallet_index(4)]
    pub type Balances = pallet_balances;

    #[runtime::pallet_index(5)]
    pub type TransactionPayment = pallet_transaction_payment;

    #[runtime::pallet_index(6)]
    pub type Sudo = pallet_sudo;

    // Example template pallet (if present in your workspace).
    #[runtime::pallet_index(7)]
    pub type Template = pallet_template;

    // Our PoBA pallet
    #[runtime::pallet_index(8)]
    pub type Poba = pallet_poba;

	// our bids pallet
	#[runtime::pallet_index(9)]
    pub type Bids = pallet_bids;
}

// ---------------------------- Bids pallet Config -----------------------------
pub use pallet_bids;

parameter_types! {
    pub const MaxNotesLen: u32 = 256;
}
impl pallet_bids::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type MaxNotesLen = MaxNotesLen;
}


// ----------------------------- PoBA pallet config -----------------------------
pub use pallet_poba;

parameter_types! {
    pub const MaxMatchesPerProposal: u32 = 200;
}
impl pallet_poba::Config for Runtime {
    type RuntimeEvent = RuntimeEvent;
    type MaxMatchesPerProposal = MaxMatchesPerProposal;
}


// --------------------------- Pallet Config impls ----------------------------
// NOTE: To keep the file tidy, most Config impls live in `runtime/src/configs.rs`.
pub use configs::*;
