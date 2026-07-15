# Going live (and checking it worked)

Everything ships on the `main` branch. Production is a Vercel project that
watches `main`; every merge auto-deploys. This page is the checklist.

## One-time setup

1. **Vercel**: vercel.com → Add New Project → import this GitHub repo.
   Set **Root Directory** to `apps/web`. Framework auto-detects (Next.js),
   pnpm workspaces are handled natively. First deploy happens on import.
2. **Supabase**: create a project, then run every file in
   `supabase/migrations/` in order (SQL editor, or `supabase db push`).
   As of now that's `0001` → `0006`. New migrations get run the same way
   when they land.
3. **Environment variables** (Vercel → Project → Settings → Environment
   Variables). From `apps/web/.env.example`:
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`: persistence on. Without
     them the site runs in demo mode (works, saves nothing).
   - `OPS_PASSWORD`: locks the admin console subpages. Browser prompts:
     any username, this password.
   - `GETADDRESS_API_KEY` (optional): address autofill for postcodes not
     yet in the property database. Free tier at getaddress.io.
   - `RESEND_API_KEY` + `EMAIL_FROM` + `NEXT_PUBLIC_APP_URL` (optional):
     quote emails.
4. **Data**: download the EPC bulk files and run the importer
   (see [property-intelligence.md](./property-intelligence.md)). Hit
   **Recompute scores** on `/ops/intel` afterwards.

## How to check a deploy worked

1. Vercel dashboard → Deployments: the top entry should be `main`, status
   **Ready**, with the commit message you expect.
2. On the live site, walk the smoke list:
   - `/` loads with the Dang, It's Hot brand.
   - `/quote` gives a price in a couple of minutes.
   - `/p/demo` plays the whole install timeline.
   - `/a/demo` shows a per-address mailing page.
   - `/ops` shows the console; `/ops/intel`, `/ops/projects`,
     `/ops/quotes`, `/ops/templates` ask for the ops password, then load.
3. Data check (with Supabase connected): submit a test quote at `/quote`,
   then find it at `/ops/quotes`. Start its project from the saved quote
   page and find it at `/ops/projects`.

If a deploy is missing, the usual suspects: the Vercel project is watching
a different branch (should be `main`), or the build failed (open the
deployment's logs; `pnpm build` locally reproduces it).

## The admin console

`/ops` is mission control: live modules (property intelligence, projects,
quote requests, template library, schedule, procurement), the customer-side
pages for reference, and the not-built-yet roadmap. Also reachable from the "Prototype" strip at
the bottom of every page and the Platform column in the footer.
