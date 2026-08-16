# Star1 Frontend

The web interface for **Star1** — Huygens's autonomous research instrument.

> The rabbit hole is yours.

---

## What this is

This is a **static frontend** that connects to:
- **Your GitHub repo** (runs the Winery backend via GitHub Actions)
- **Supabase** (auth + research history database)

The backend (Qwen3-4B model, research pipeline) lives in a separate repo.

---

## Deploy anywhere

### Vercel (recommended)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project
3. Select this repo
4. Framework preset: **Other**
5. Deploy

Vercel will serve it as static files. No build step needed.

### GitHub Pages

1. Push this repo to GitHub
2. Settings → Pages → Source: `main` / root
3. Wait 1-2 minutes
4. Visit your Pages URL

### Netlify / Cloudflare Pages / anywhere

Just upload the files. It's plain HTML/CSS/JS.

---

## First-time setup

When you open the app:

1. **Supabase tab:**
   - URL: `https://your-project.supabase.co`
   - Anon Key: from Supabase Dashboard → Project Settings → API
   - Click **Save & Connect**

2. **GitHub tab:**
   - PAT: GitHub token with `repo` + `actions` scope
   - Repository: `yourusername/your-backend-repo` (where Winery lives)
   - Click **Test connection** → **Save**

3. **Sign in** with email (magic link) or GitHub OAuth

---

## File structure

```
star1-frontend/
├── index.html          # Landing page
├── app.html            # Research app (auth + UI)
├── assets/
│   ├── style.css       # Star1 design system
│   └── app.js          # Auth, DB, GitHub API logic
├── vercel.json         # Forces static deployment on Vercel
└── README.md
```

---

## Connecting to your backend

The frontend does NOT need to be in the same repo as the backend.

In the settings, you specify which GitHub repo contains the Winery backend. The frontend triggers `workflow_dispatch` events on that repo via the GitHub API.

Example:
- Frontend repo: `yourname/star1-web` (this repo, on Vercel)
- Backend repo: `yourname/star1-backend` (Winery + GitHub Actions)

---

## Environment variables

None required. All config is stored in:
- `localStorage` (GitHub PAT, Supabase credentials)
- Supabase DB (research history, user profile)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Vercel says "main.py not found" | `vercel.json` is included. Make sure it's in the root. |
| CORS errors on Supabase | Add your frontend domain to Supabase → Auth → URL Configuration → Site URL |
| "Connection failed" on GitHub test | Check PAT has `repo` + `actions` scope. Check repo slug is correct. |
| Magic link not received | Check spam. Supabase free tier has rate limits. |

---

## License

Personal use only. Star1 is a Huygens product.
