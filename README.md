# Campus Dorm Marketplace

Skeleton project for a campus dorm marketplace using:
- Frontend: single-page `index.html` + `styles.css` + `app.js` (vanilla JS + Bootstrap)
- Backend: ASP.NET Core Web API (C#)
- Database: MySQL (raw SQL, no ORM)

## Project Structure

- `frontend/` static UI files
- `backend/` ASP.NET Core Web API
- `database/schema.sql` MySQL schema placeholder

## Local Run

1. Start backend:
   - `cd backend`
   - `dotnet run`
2. Open app in browser:
   - `http://localhost:5000` (or the URL printed by `dotnet run`)
3. Smoke test:
   - Frontend `app.js` calls `GET /api/health`
   - Backend returns `{ "status": "ok" }`
   - Check browser console for logged response
