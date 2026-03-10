## Project Overview

BidDrop is a decentralized crowd-shipping and ride-sharing platform that connects people who need to send packages with drivers already traveling between cities.

Drivers can publish upcoming trips, while senders can create delivery requests.  
The system automatically matches packages with available drivers traveling along similar routes.

Unlike traditional platforms, the matching process is performed through a blockchain-based auction mechanism that selects the best assignment in a transparent and decentralized way.

---

# Project Overview

BidDrop allows users to send packages between cities by matching them with drivers who are already planning the same route.

Instead of relying on a centralized service, the matching process is performed using a blockchain-based consensus mechanism called **Proof of Bid Assignment (PoBA)**.

The platform includes:

- A mobile application for senders and drivers
- A backend API server
- A PostgreSQL database
- A custom Substrate blockchain runtime
- A decentralized auction-based matching algorithm

---

## Motivation

Many people travel between cities every day with empty space in their vehicles.  
At the same time, others need to send packages quickly and affordably.

BidDrop combines ride-sharing and crowd-shipping by allowing drivers to deliver packages while already traveling along their planned route.

This reduces delivery costs, improves efficiency, and leverages unused transportation capacity.

---

# System Architecture

The system consists of four main components:

1. **Mobile Application (React Native / Expo)**  
   Allows users to create delivery requests, offer rides, and manage assignments.

2. **Backend Server (FastAPI)**  
   Handles authentication, database operations, and communication with the blockchain.

3. **Blockchain Network (Substrate)**  
   Runs a custom runtime implementing the PoBA consensus logic.

4. **Database (PostgreSQL)**  
   Stores users, requests, offers, assignments, and escrow records.

---

# Technologies Used

### Mobile
- React Native
- Expo
- TypeScript

### Backend
- FastAPI
- Python
- PostgreSQL

### Blockchain
- Substrate
- Rust
- Custom pallets:
  - PoBA pallet
  - Escrow pallet

### Infrastructure
- Docker
- WebSocket communication with blockchain nodes

---

## Key Features

- Ride-sharing trip publication by drivers
- Package delivery requests by senders
- Matching packages with drivers already traveling on similar routes
- Auction-based assignment selection
- Blockchain-based PoBA consensus
- On-chain escrow payments
- Real-time assignment status tracking

---

## Project Documentation

The full project documentation is available here:

📄 [BidDrop Project Book](docs/Auction_Based_consensus_for_crowd_shipping-18-2.pdf)

