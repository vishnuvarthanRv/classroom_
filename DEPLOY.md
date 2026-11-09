# Railway Deploy Guide

## Step 1 — GitHub account தேவை
https://github.com → Sign up (free)

## Step 2 — Git install & project upload

Terminal la (project folder la):

```
git init
git add .
git commit -m "first commit"
```

GitHub la new repository create pannu:
- https://github.com/new
- Repository name: classroom-portal
- Public → Create

Then:
```
git remote add origin https://github.com/YOUR_USERNAME/classroom-portal.git
git branch -M main
git push -u origin main
```

## Step 3 — Railway account
https://railway.app → Sign up with GitHub (free)

## Step 4 — Deploy

1. Railway dashboard → **New Project**
2. **Deploy from GitHub repo** → classroom-portal select pannu
3. Railway auto-detect பண்ணும் → Deploy click

## Step 5 — MySQL add pannu

1. Project dashboard → **+ New** → **Database** → **MySQL**
2. MySQL service created → click on it
3. **Variables** tab → `MYSQL_URL` copy pannu

## Step 6 — Environment Variables set pannu

1. Your app service click → **Variables** tab
2. Add:
   - `MYSQL_URL` = (MySQL service la irundhu copy pannina URL)
   - `NODE_ENV` = production

## Step 7 — Done!

Railway automatically oru URL kudukum:
`https://classroom-portal-production.up.railway.app`

Adha QR codes generate aagum — entha phone la yaarum scan pannalaam!

## Note
- Free tier: 500 hours/month
- Sleep aagaadhu (always on)
- QR images /tmp la store aagum (server restart aana regenerate aagum — normal)
