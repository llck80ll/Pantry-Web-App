# My Pantry Recipes - Production & Hosting Guide

Welcome to the production-ready build for **My Pantry Recipes**, a full-stack recipe manager and matching engine powered by Vite (React + TypeScript), Supabase Auth, and a lightweight Express backend.

This codebase is optimized to run seamlessly in local dev, in containers (e.g., Docker, Cloud Run), and on cloud application hosters.

---

## 🏗️ Architecture Layout

1. **Frontend (`/src`):** Modular React SPA styled using Tailwind CSS, featuring smooth tab systems and custom audio cues.
2. **Backend Engine (`/server.ts`):** Lightweight Express server proxying AI calls, executing recipe-matching calculations, and managing simple user-authored recipes.
3. **Database (`/src/recipes_db.json`):** Local fallback file database storing raw recipe feeds.

---

## 🔒 Required Secrets & Config Variables

Before deploying the app, make sure to configure these environment variables on your server console or `.env` configuration file:

| Variable Name | Required? | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Required** | Access code for Google Gemini AI features and recipe processing. |
| `PORT` | _Optional_ | Port to bind to (Defaults to `3000` for hosting ingest rules). |

---

## 📦 Local Compilation & Fast Run

To run a fast development server or compile the static build locally, run the standard npm commands:

```bash
# 1. Install all system dependencies
npm install

# 2. Spin up local full-stack hot-reload server
npm run dev

# 3. Compile full-stack React assets and server files
npm run build

# 4. Spin up production server compiled assets
npm run start
```

---

## 🚀 Cloud Web Hosting Deployment Guide

### Option A: Google Cloud Run (Highly Recommended ☁️)

A production-ready **`Dockerfile`** featuring a multi-stage, secure Alpine build has been pre-packaged at the root of this project.

1. Install the Google Cloud SDK and authenticate:
   ```bash
   gcloud auth login
   ```
2. Build and launch the container on GCP with one command:
   ```bash
   gcloud run deploy my-pantry-recipes \
     --source . \
     --allow-unauthenticated \
     --region us-central1 \
     --set-env-vars="GEMINI_API_KEY=your_gemini_key_here"
   ```

---

### Option B: Render or Railway (⚡ Simple Git-Push Setup)

Render and Railway offer seamless hosting directly from a connected GitHub repository.

- **Environment Engine:** `Node.js` (v20+)
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run start`

---

### Option C: Vercel / Netlify Serverless Deployment (▲)

For serverless deployments, you can deploy the React frontend in `dist/` as static assets and map the Express server using a root `vercel.json` configurations:

```json
{
  "version": 2,
  "builds": [
    { "src": "server.ts", "use": "@vercel/node" },
    { "src": "package.json", "use": "@vercel/next" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "server.ts" },
    { "src": "/(.*)", "dest": "/dist/$1" }
  ]
}
```

---

### Option D: Traditional Virtual Server (VPS / PM2 Ubuntu 🖥️)

For VM droplets, Cafe24 hosting, or direct private servers:

1. Copy the built `dist/` output and `package.json` to your server.
2. Solder the application in continuous background mode using PM2:
   ```bash
   # Install pm2 process manager
   sudo npm install -g pm2
   
   # Launch Compiled Node server
   pm2 start dist/server.cjs --name "my-pantry-recipes"
   
   # Retain process across system reboots
   pm2 startup
   pm2 save
   ```

---

## 🧑‍🍳 App Preservation Note

Standard serverless environments like Render or Cloud Run spin on stateless containers. This means custom recipes authored on the live fly (written onto `recipes_db.json`) will reset to raw baselines during automatic container restarts. 

For resilient persistence across large-scale deployments, refer to the Firebase skill integrations or hook up an external SQL database server!
