# Loomspace

A woven thread canvas for project ideas and AI chats.

## Disclaimer
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## A Warning!
This is a browser-only codebase and entering your api keys into it is INHERENTLY INSECURE!  Sure, the cookie is encrypted, but it is not a real solution to the problem!

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Backend (INT-21 Phase 1)

A FastAPI backend now exists under `backend/` with:
- SQLite-backed encrypted secret manager
- first AI proxy endpoint (`POST /api/ai/chat`)
- health check (`GET /healthz`)

### Run backend locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# set LOOMSPACE_SECRET_MANAGER_KEY in .env
uvicorn app.main:app --reload --port 8000
```

### API endpoints

- `POST /api/secrets/upsert` — save/update encrypted API key for a provider profile
- `GET /api/secrets/{provider_config_id}/exists` — check if a key exists
- `DELETE /api/secrets/{provider_config_id}` — delete key
- `POST /api/ai/chat` — proxy model request using stored provider secret

## Current slice

- editable title node at the top of each thread
- chat node beneath the title node
- request/response pairs append as new nodes
- active thread context stays with that lane
- browser-saved OpenAI API key + model in the settings panel
- flowchart-style threadlines rendered as rope

## Security

No HTML is injected from user content. API settings stay in browser storage only.
