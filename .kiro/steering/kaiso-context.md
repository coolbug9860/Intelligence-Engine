---
inclusion: always
---

# KAISO Intelligence OS — Project Context

## What This App Does
Market intelligence platform for Kaiso Research & Consulting.
Monitors global B2B news, scores business opportunities, recommends syndicated reports.

## Tech Stack
- Frontend: React 19, Tailwind CSS, Lucide icons
- Backend: Express.js, Node.js, server.ts is the entry point
- AI Runtime (IN APP): Gemini 2.5 Flash via @google/genai — DO NOT CHANGE THIS
- Hosting: Render.com
- Key services folder: src/services/ (37 files)

## Business Context
- We publish syndicated research reports priced at $4,000–$8,000
- Target buyers: large enterprises ($100M+ revenue)
- 14 verticals: Healthcare, Semiconductors, Energy, Fintech, Automotive, etc.

## Critical Rules for Kiro
- NEVER change the Gemini SDK or geminiService.ts model settings
- NEVER install new npm packages without asking me first
- NEVER modify src/types.ts interfaces without showing me the change first
- Always show me what changed in plain English before applying changes
- Keep responses concise — show code changes, not long explanations
