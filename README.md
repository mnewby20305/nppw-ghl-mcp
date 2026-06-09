# GHL MCP Server — No Pressure Power Washing

MCP server that connects Claude.ai to GoHighLevel CRM. Manage contacts, pipelines, and workflows by typing natural language messages in Claude.

## Tools Available

| Tool | What it does |
|---|---|
| `ghl_create_contact` | Create a new contact |
| `ghl_search_contacts` | Search by name, email, or phone |
| `ghl_get_contact` | Get full contact details by ID |
| `ghl_list_pipelines` | List all pipelines and stage IDs |
| `ghl_list_workflows` | List all workflow IDs and names |
| `ghl_get_opportunities` | Get pipeline opportunities for a contact |
| `ghl_move_pipeline_stage` | Move an opportunity to a new stage |
| `ghl_trigger_workflow` | Trigger a workflow for a contact |

---

## Deploy to Railway

### Step 1 — Create GitHub repo

Push this folder to a new GitHub repo named `nppw-ghl-mcp`.

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project** → **Deploy from GitHub repo**
3. Connect your GitHub account if prompted
4. Select the `nppw-ghl-mcp` repo
5. Click **Deploy Now**

### Step 3 — Set environment variables

In Railway, go to your service → **Variables** tab → **Add Variable**:

| Variable | Value |
|---|---|
| `GHL_API_KEY` | `pit-6dc5107a-2bff-4415-922b-16d1c7f570b0` |
| `GHL_LOCATION_ID` | `NUrUflrnfVcqSxE0nrHl` |
| `TRANSPORT` | `http` |

Railway automatically sets `PORT`.

### Step 4 — Generate a public domain

1. In Railway, go to your service → **Settings** → **Networking**
2. Click **Generate Domain**
3. You'll get a URL like `https://nppw-ghl-mcp.up.railway.app`

### Step 5 — Connect to Claude.ai

1. Open [claude.ai](https://claude.ai) → **Settings** → **Integrations**
2. Click **Add Integration**
3. Enter your Railway URL + `/mcp`:
   ```
   https://nppw-ghl-mcp.up.railway.app/mcp
   ```
4. Name it **GHL Manager** → Save

That's it. Claude can now manage your GHL account from any device.

---

## Local Development

```bash
# Install dependencies
npm install

# Create .env file
echo "GHL_API_KEY=your_key" > .env
echo "GHL_LOCATION_ID=your_location_id" >> .env
echo "TRANSPORT=http" >> .env

# Run in dev mode
npm run dev

# Build
npm run build
npm start
```

## Example Usage in Claude.ai

> "Add new lead: Sarah Johnson, 919-555-0000, sarah@gmail.com, tagged as residential"

> "Find Michael Green and tell me what pipeline stage he's in"

> "Move opportunity ID xyz to the Booked stage"

> "Trigger the post-job follow-up workflow for contact abc123"
