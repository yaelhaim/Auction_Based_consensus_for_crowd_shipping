//! PoBA worker – pulls market, asks backend to BUILD an IDA* proposal,
//! then asks backend to submit signed extrinsics (submit_proposal / finalize_slot).

use crate::service::FullClient;
use sc_transaction_pool::TransactionPool;
use sp_api::ProvideRuntimeApi;
use sp_runtime::traits::Block as BlockT;
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::Client as Http;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketRequest {
    pub uuid_16: [u8; 16],
    pub from_lat: i32,
    pub from_lon: i32,
    pub to_lat: i32,
    pub to_lon: i32,
    pub max_price_cents: u32,
    pub kind: u8, // 0=package,1=passenger
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketOffer {
    pub uuid_16: [u8; 16],
    pub min_price_cents: u32,
    pub from_lat: i32,
    pub from_lon: i32,
    pub to_lat: i32,
    pub to_lon: i32,
    pub window_start: u64,
    pub window_end: u64,
    pub types_mask: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchItem {
    pub request_uuid: [u8; 16],
    pub offer_uuid: [u8; 16],
    pub agreed_price_cents: u32,
    pub partial_score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitProposalBody {
    pub slot: u64,
    pub total_score: i64,
    pub matches: Vec<MatchItem>,
}

#[derive(Debug, Clone, Deserialize)]
struct BuildResp {
    slot: u64,
    total_score: i64,
    matches: Vec<MatchItem>,
}

/// 6s per slot (dev). In prod עדיף לקבל את הסלוט מ-Aura.
fn current_slot() -> u64 {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    ms / 6000
}

pub async fn run<B: BlockT>(
    _client: Arc<FullClient>,
    _tx_pool: Arc<TransactionPool<B, FullClient>>,
    _keystore: sp_core::traits::BareCryptoStorePtr,
    backend_url: String,
) {
    let http = Http::new();

    loop {
        // 1) Pull open market from backend
        let req_url = format!("{}/poba/requests-open", backend_url);
        let off_url = format!("{}/poba/offers-open", backend_url);

        let (requests, offers): (Vec<MarketRequest>, Vec<MarketOffer>) = match (
            http.get(&req_url).send().await,
            http.get(&off_url).send().await,
        ) {
            (Ok(r1), Ok(r2)) => {
                let rs: Vec<MarketRequest> = r1.json().await.unwrap_or_default();
                let os: Vec<MarketOffer> = r2.json().await.unwrap_or_default();
                (rs, os)
            }
            _ => {
                log::warn!("PoBA worker: backend not reachable at {}", backend_url);
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };

        // 2) Ask BACKEND to build proposal via IDA*
        let slot = current_slot();
        #[derive(serde::Serialize)]
        struct BuildBody<'a> {
            slot: u64,
            requests: &'a Vec<MarketRequest>,
            offers: &'a Vec<MarketOffer>,
        }
        let build_url = format!("{}/poba/build-proposal", backend_url);
        let resp = http
            .post(&build_url)
            .json(&BuildBody {
                slot,
                requests: &requests,
                offers: &offers,
            })
            .send()
            .await;

        let BuildResp {
            total_score,
            matches,
            ..
        } = match resp {
            Ok(r) => match r.json::<BuildResp>().await {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("PoBA worker: build-proposal JSON failed: {e}");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
            },
            Err(e) => {
                log::warn!("PoBA worker: build-proposal HTTP failed: {e}");
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
        };

        // 3) Ask backend to submit signed extrinsic
        let submit_url = format!("{}/poba/submit-proposal", backend_url);
        let body = SubmitProposalBody {
            slot,
            total_score,
            matches: matches.clone(),
        };
        if let Err(e) = http.post(&submit_url).json(&body).send().await {
            log::warn!("PoBA worker: submit-proposal failed: {e}");
        }

        // 4) Try finalize the slot (only the author’s call will land in-time)
        let finalize_url = format!("{}/poba/finalize-slot", backend_url);
        let _ = http
            .post(&finalize_url)
            .json(&serde_json::json!({ "slot": slot }))
            .send()
            .await;

        tokio::time::sleep(Duration::from_secs(3)).await; // ~half slot
    }
}
