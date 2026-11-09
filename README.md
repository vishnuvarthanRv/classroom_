# Classroom Asset Portal

## How to Run

1. Open a terminal in this folder
2. Run:  npm install  (only first time)
3. Run:  node server.js
4. Open browser: http://localhost:3000

## Features
- Add classroom items (Chair, Table, PC, CPU, Monitor, Projector, Whiteboard)
- Auto QR code generation for each item
- Scan QR → view item details on any device (phone, tablet)
- Search and filter assets
- Edit and delete assets
- Download QR code as image

## Files
- server.js      → Backend (Node.js + Express)
- classroom.db   → Database (auto-created on first run)
- views/         → HTML templates
- public/        → CSS + QR code images
"# classroom_" 
