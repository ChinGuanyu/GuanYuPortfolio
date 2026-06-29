# Backend setup (Supabase)

Your portfolio now has a real backend. Edits made in editor mode (CV, projects,
uploaded images/3D files, page text) are saved to Supabase, so they persist for
**everyone, across devices** — not just the browser you edited in.

Until you finish the steps below, the site keeps working but falls back to
**browser-only** storage (edits stay on one device). Nothing breaks in the meantime.

This is a one-time setup, ~10 minutes.

---

## 1. Create a free Supabase project

1. Go to <https://supabase.com> → sign up (free).
2. **New project** → pick a name, a strong database password, and a region near you.
3. Wait ~2 minutes for it to provision.

## 2. Copy your two public keys

In the project dashboard: **Project Settings → API**.

- **Project URL** — looks like `https://abcdefgh.supabase.co`
- **anon public** key — a long string under "Project API keys"

Both are safe to put in the code and commit publicly. (Write access is protected
by the login + security rules below — the anon key alone can only *read*.)

## 3. Create the database table, storage bucket, and security rules

In the dashboard: **SQL Editor → New query**, paste all of this, and click **Run**:

```sql
-- Content table (CV fields, project/blog data, page text — all as JSON)
create table if not exists public.site_content (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now()
);

alter table public.site_content enable row level security;

create policy "Public can read content"
  on public.site_content for select using (true);
create policy "Authed can insert content"
  on public.site_content for insert to authenticated with check (true);
create policy "Authed can update content"
  on public.site_content for update to authenticated using (true) with check (true);
create policy "Authed can delete content"
  on public.site_content for delete to authenticated using (true);

-- Storage bucket for images and .fbx files (public read)
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "Public can read media"
  on storage.objects for select using (bucket_id = 'media');
create policy "Authed can upload media"
  on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "Authed can update media"
  on storage.objects for update to authenticated using (bucket_id = 'media');
create policy "Authed can delete media"
  on storage.objects for delete to authenticated using (bucket_id = 'media');
```

> If you run it twice you'll get "policy already exists" errors — that's harmless.

## 4. Create your login (the single shared password)

**Authentication → Users → Add user → Create new user**

- **Email:** `guanyu1253@gmail.com` (must match `OWNER_EMAIL` in `js/config.js`)
- **Password:** choose your password — this is what you'll type on the site
- Make sure **Auto Confirm User** is enabled (it is by default in this dialog)

That's it for the password. On the site you only type the password; the email is
paired automatically behind the scenes.

## 5. Plug the keys into the site

Open **`js/config.js`** and replace the three values:

```js
export const SUPABASE_URL      = 'https://abcdefgh.supabase.co';  // your Project URL
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';                 // your anon public key
export const OWNER_EMAIL       = 'guanyu1253@gmail.com';          // the user you created
```

Then commit & push:

```bash
git add js/config.js
git commit -m "Connect Supabase backend"
git push
```

GitHub Pages redeploys automatically. Done — edits are now global.

---

## How to use it

- **Open editor:** `Ctrl + Shift + E` → type your password.
- Edit anything (CV, project boxes, tags, page titles), upload images/`.fbx`,
  delete boxes, etc. Changes save to Supabase automatically.
- **Exit Editor** (top-right) or `Ctrl + Shift + E` again to log out.
- Visitors see everything read-only; they can't edit without the password.

## Notes & limits (free tier)

- Free tier: 500 MB database + 1 GB file storage — plenty for a portfolio.
  Large `.fbx` files eat the storage budget fastest; keep them reasonable.
- Your existing browser-only edits are pushed up automatically the first time
  you load the site after connecting Supabase (one-time migration).
- The URL + anon key are meant to be public. Never paste the **service_role**
  key or your database password into the site code.
