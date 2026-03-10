
# BidDrop

BidDrop is a decentralized crowd-shipping and ride-sharing platform that enables both package delivery and shared rides between cities.

The system connects senders, passengers, and drivers who are already planning intercity trips, and uses a blockchain-based auction mechanism to select the best assignment in a transparent and decentralized way.

This project was developed as part of our **B.Sc. Software Engineering Final Project**

---

# Project Overview

BidDrop allows users to either send packages or request rides between cities by matching them with drivers who are already planning the same route.

Drivers can publish upcoming trips and specify available capacity in their vehicles, both for passengers and packages. Senders can create delivery requests, while passengers can request rides. The system then matches these requests with suitable drivers traveling along similar routes.

Instead of relying on a centralized service, the matching process is performed using a blockchain-based consensus mechanism called **Proof of Bid Assignment (PoBA)**, which selects the best assignment proposal in a transparent and decentralized way.

The platform includes:

- A mobile application for senders, passengers, and drivers
- A backend API server
- A PostgreSQL database
- A custom Substrate blockchain runtime
- A decentralized auction-based matching algorithm

---

## Motivation

Many people travel between cities every day with unused capacity in their vehicles, including both empty seats and free space for packages.

At the same time, others may need either to send a package or to find a ride between cities.

BidDrop combines ride-sharing and crowd-shipping by allowing drivers to transport passengers and deliver packages while already traveling along their planned route.

This approach reduces delivery costs, improves transportation efficiency, and leverages unused vehicle capacity.

---

# System Architecture

The system consists of four main components:

1. **Mobile Application (React Native / Expo)**  
   Allows users to create delivery requests, request rides, publish trips, and manage assignments.

2. **Backend Server (FastAPI)**  
   Handles authentication, database operations, and communication with the blockchain.

3. **Blockchain Network (Substrate)**  
   Runs a custom runtime implementing the PoBA consensus logic for selecting optimal assignments.

4. **Database (PostgreSQL)**  
   Stores users, requests, ride offers, delivery offers, assignments, and escrow records.

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
- Ride requests for passengers
- Package delivery requests by senders
- Matching passengers and packages with drivers already traveling on similar routes
- Auction-based assignment selection
- Blockchain-based PoBA consensus
- On-chain escrow payments
- Real-time assignment status tracking

---

## Project Documentation

The full project documentation is available here:

📄 [BidDrop Project Book](docs/Auction_Based_consensus_for_crowd_shipping-18-2.pdf)
