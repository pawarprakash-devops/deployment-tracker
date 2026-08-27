# ✅ Automatic Deployment Tracking - Ready to Use!

## 🎉 Setup Complete!

Your deployment tracker now supports **automatic tracking** from GitHub Actions workflows!

---

## 🔗 Webhook Endpoint

**URL:** `https://deployment-tracker-taupe.vercel.app/api/webhook`

**Status:** ✅ Live and Working

**Test Result:** Successfully logged test deployment to QA environment!

---

## 🚀 Quick Start Integration

### Step 1: Add Secrets to vidai-devops

Go to: https://github.com/vidaisolutions/vidai-devops/settings/secrets/actions

Add two secrets:

**`TRACKER_WEBHOOK_URL`**
```
https://deployment-tracker-taupe.vercel.app/api/webhook
```

**`TRACKER_WEBHOOK_SECRET`**
```
change-me-in-production
```

⚠️ **Important:** Generate a secure token and update both:
- GitHub secret: `TRACKER_WEBHOOK_SECRET`
- Vercel env var: `WEBHOOK_SECRET`

```bash
# Generate secure token
openssl rand -hex 32
```

---

### Step 2: Update Vercel Environment Variable

Go to: https://vercel.com/prakash-pawar/deployment-tracker/settings/environment-variables

Update:
- **Key:** `WEBHOOK_SECRET`
- **Value:** (your new secure token)
- **Environments:** All

Then redeploy:
```bash
cd /home/pawarpr/Desktop/WSL-Backup/deployment-tracker
vercel --prod
```

---

### Step 3: Add to GitHub Actions Workflows

Add this step to your deployment workflows in `vidai-devops`:

```yaml
- name: Log to Deployment Tracker
  if: always()
  run: |
    # Map cluster to environment
    CLUSTER="${{ github.event.inputs.cluster }}"
    if [[ "$CLUSTER" == *"qa-aps"* ]]; then ENV="QA"
    elif [[ "$CLUSTER" == *"stage"* ]]; then ENV="Stage"
    elif [[ "$CLUSTER" == *"preview-99999"* ]]; then ENV="Preview"
    elif [[ "$CLUSTER" == *"pre-prod-usw"* ]]; then ENV="Pre-Prod USW"
    elif [[ "$CLUSTER" == *"pre-prod"* ]]; then ENV="Pre-Prod"
    elif [[ "$CLUSTER" == *"production"* ]]; then ENV="Production"
    else ENV="Other"
    fi
    
    STATUS="${{ job.status == 'success' && 'Success' || 'Failed' }}"
    
    curl -X POST "${{ secrets.TRACKER_WEBHOOK_URL }}" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${{ secrets.TRACKER_WEBHOOK_SECRET }}" \
      -d '{
        "environment": "'"$ENV"'",
        "status": "'"$STATUS"'",
        "branch": "${{ github.event.inputs.branch_to_deploy }}",
        "version": "${{ github.event.inputs.image_tag }}",
        "requested_by": "${{ github.actor }}",
        "deployed_by": "GitHub Actions",
        "ticket_link": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
        "notes": "Deploy: ${{ github.event.inputs.deploy_to }}",
        "started_at": "${{ github.event.workflow_run.created_at }}"
      }' || true
```

---

## ✅ Test the Integration

### 1. Manual Test (Already Done ✅)

```bash
curl -X POST https://deployment-tracker-taupe.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer change-me-in-production" \
  -d '{
    "environment": "QA",
    "status": "Success",
    "branch": "main",
    "version": "v1.0.0",
    "requested_by": "prakash",
    "started_at": "2026-08-27T10:00:00Z"
  }'
```

**Result:** ✅ Success! Deployment logged to database.

### 2. View Test Deployment

Open: https://deployment-tracker-taupe.vercel.app

You should see the test deployment in the QA row!

---

## 📊 What Happens Automatically

```
Developer triggers deployment
         ↓
GitHub Actions runs workflow
         ↓
Deployment executes (backend/frontend)
         ↓
Webhook step sends POST request
         ↓
Deployment Tracker API receives data
         ↓
Data saved to Neon database
         ↓
Dashboard auto-refreshes (5 seconds)
         ↓
✅ Deployment appears in real-time!
```

---

## 📋 Environment Mapping

| Cluster Name | Environment |
|--------------|-------------|
| `qa-aps-ecs-cluster` | QA |
| `vidai-solutions-stage-*` | Stage |
| `vidai-solutions-preview-99999-*` | Preview |
| `vidai-solutions-pre-prod-*` | Pre-Prod |
| `pre-prod-usw-ecs-cluster` | Pre-Prod USW |
| `production-aps-*` | Production |
| `lms-usw-*` | LMS |

---

## 🔍 Monitoring & Debugging

### View Recent Deployments
```bash
curl https://deployment-tracker-taupe.vercel.app/api/deployments
```

### Check Webhook Health
```bash
curl https://deployment-tracker-taupe.vercel.app/api/webhook
```

### View Vercel Logs
```bash
vercel logs https://deployment-tracker-taupe.vercel.app/api/webhook --follow
```

### Check GitHub Actions Logs
1. Go to: https://github.com/vidaisolutions/vidai-devops/actions
2. Click on a workflow run
3. Check the "Log to Deployment Tracker" step

---

## 📚 Documentation Files

- **Integration Guide:** `/home/pawarpr/Desktop/WSL-Backup/deployment-tracker/AUTOMATIC_TRACKING.md`
- **Reusable Workflow:** `/home/pawarpr/Desktop/WSL-Backup/deployment-tracker/log-deployment-workflow.yaml`
- **Webhook API:** `/home/pawarpr/Desktop/WSL-Backup/deployment-tracker/app/api/webhook/route.ts`
- **This Quickstart:** `/home/pawarpr/Desktop/WSL-Backup/deployment-tracker/QUICKSTART_AUTO_TRACKING.md`

---

## ✨ Benefits

After integration:
- ✅ **Zero manual entry** - Deployments logged automatically
- ✅ **Real-time updates** - Dashboard refreshes every 5 seconds
- ✅ **Complete history** - All deployments tracked
- ✅ **Failed deployments too** - Even failures are logged
- ✅ **Audit trail** - Who deployed what, when
- ✅ **API access** - Query deployment history programmatically

---

## 🎯 Next Steps

1. **Update secrets** (both GitHub and Vercel) with a secure token
2. **Add webhook step** to `full_deployment.yaml` in vidai-devops
3. **Test with real deployment** - Trigger a QA deployment
4. **Verify on dashboard** - Check https://deployment-tracker-taupe.vercel.app

---

## 💡 Pro Tips

- The webhook step uses `|| true` so it never blocks deployments even if it fails
- Use `if: always()` to log even failed deployments
- Include `${{ github.run_id }}` in ticket_link for easy GitHub Actions access
- Map cluster names carefully to get correct environment names

---

**Ready to automate!** 🚀

View your dashboard: https://deployment-tracker-taupe.vercel.app
