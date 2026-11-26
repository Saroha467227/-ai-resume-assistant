# Resume Studio

Resume Studio is a JavaScript MERN app for job seekers. Upload a resume, add a job description, review the fit report, and practice a text interview based on the role. Your workspace keeps the resumes, job descriptions, reports, and interview history together.

## Run locally on Windows

Use Node.js 22.12 or newer and a running MongoDB instance. MongoDB can run locally or on Atlas. Open PowerShell in the project folder.

~~~powershell
npm.cmd install
~~~

The active workspace already has a local server configuration. For a fresh checkout, create one from the example and generate a session secret.

~~~powershell
$settings = 'server\.env'
if (-not (Test-Path -LiteralPath $settings)) {
  $secret = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
  (Get-Content -LiteralPath 'server\.env.example' -Raw).Replace('JWT_SECRET=', ('JWT_SECRET=' + $secret)) |
    Set-Content -LiteralPath $settings -Encoding utf8
}
~~~

The default connection is [local MongoDB](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/) at 127.0.0.1:27017. For Atlas, replace the value of `MONGODB_URI` in `server/.env` with your connection string and include a database name.

~~~powershell
npm.cmd run dev
~~~

Open [Resume Studio](http://127.0.0.1:5173). Vite proxies requests under `/api` to Express on port 5000. The API’s [health endpoint](http://127.0.0.1:5000/api/health) reports database availability.

`npm.cmd run seed:questions` optionally loads the curated question bank into MongoDB. The same questions are available from source until you run the seed.

## Try the complete flow

1. Create an account. Use Settings to enter your target role.
2. Open **Resumes** and upload a text-based PDF or DOCX up to 5 MB. Expand a skill to see the line where it was detected. To create a synthetic resume for a trial, run the command below from the project folder.
3. Open **Job descriptions**, enter a title, and paste a posting. Include headings such as **Required** and **Preferred** so rule-based extraction can identify both groups.
4. Open **Fit analysis**, select the resume and job, and compare them. Review the matched skills, gaps, and suggestions.
5. Choose **Practice this interview**, start the session, and answer the questions. A score of 1 or 2 can trigger up to two follow-ups for the original question. Find completed and in-progress sessions in **Interviews**.

~~~powershell
node --input-type=module -e "import { writeFileSync } from 'node:fs'; import { pdfWithText, resumeLines } from './server/fixtures/resume-documents.js'; writeFileSync('sample-resume.pdf', pdfWithText(resumeLines), {flag:'wx'});"
~~~

Sample job posting for the synthetic resume

> Required: Node.js, Express, MongoDB, Redis, and 3 years of experience.
>
> Preferred: Docker and GraphQL.

## Enable Gemini

Set `GEMINI_API_KEY` in `server/.env` and restart the API. `GEMINI_MODEL` selects the model and `LLM_DAILY_LIMIT` caps calls per account per UTC day. Gemini can extract additional exact excerpts, tailor interview questions, and assess answer relevance and accuracy. The server uses structured output and validates the response before using it. [Google’s structured-output documentation](https://ai.google.dev/gemini-api/docs/structured-output)

The app runs with local rules when the key is blank, the quota is exhausted, or the provider fails. Local answer scores measure how concrete an answer is and whether it includes actions and outcomes. Gemini requests use selected text with best-effort removal of emails, phone numbers, and street addresses. MongoDB stores the extracted text for the workspace. Uploaded file binaries are discarded after parsing.

## How the score works

| Component | Weight | Evidence |
| --- | ---: | --- |
| Required skills | 50 | Share of required skills detected in the resume |
| Preferred skills | 20 | Share of preferred skills detected in the resume |
| Experience | 20 | Detected years divided by required years, capped at 100% |
| Education and certifications | 10 | Share of detected requirements met |

The server divides by the total weight of the applicable components. If the posting has no scorable requirements, the report shows no score. The score describes evidence in the uploaded resume and the pasted job description.

## Code map

| Path | Responsibility |
| --- | --- |
| `client/src/` | React pages, navigation, forms, and feedback |
| `server/src/app.js` | Express API, sessions, and record ownership |
| `server/src/models.js` | Mongoose models and indexes |
| `server/src/parser.js` | PDF and DOCX validation and extraction |
| `server/src/extraction.js` | Skills, experience, and job requirement extraction |
| `server/src/scoring.js` | Weighted fit calculation |
| `server/src/interview.js` | Questions, feedback, follow-ups, and summaries |
| `server/src/llm.js` | Gemini HTTP client and daily quotas |

## Verify or serve a build

~~~powershell
npm.cmd test
npm.cmd run build
npm.cmd start
~~~

After building, Express serves the React app and API on the same origin. Open [the built app](http://127.0.0.1:5000).

To include the database-backed flow in the tests, point `TEST_MONGODB_URI` at a MongoDB server where the test user can create and remove a temporary database. The suite generates a unique test database name.

~~~powershell
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017'
npm.cmd test
~~~

For HTTPS hosting, set `NODE_ENV=production` and set `CLIENT_ORIGIN` to the public origin of the app. Set `TRUST_PROXY_HOPS` to match your deployment if there is a reverse proxy. Serve the build and API on the same origin to preserve session cookies. Keep the MongoDB connection string, JWT secret, and Gemini key in the hosting service’s environment settings.
