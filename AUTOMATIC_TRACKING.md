# 🔄 Automatic Deployment Tracking Integration Guide

This guide shows how to automatically log deployments from `vidai-devops` GitHub Actions workflows to your deployment tracker.

---

## 📋 Overview

When any deployment runs in `vidai-devops`, it will automatically send deployment data to your tracker via webhook.

**How it works:**
```
GitHub Actions Workflow
         ↓
  Log Deployment Step
         ↓
   Webhook POST
         ↓
 Deployment Tracker API
         ↓
     Neon Database
         ↓
  Real-time Dashboard
```

---

## 🔧 Setup (One-Time Configuration)

### Step 1: Add Secrets to vidai-devops Repository

Go to: https://github.com/vidaisolutions/vidai-devops/settings/secrets/actions

Add these two secrets:

**1. `TRACKER_WEBHOOK_URL`**
```
https://deployment-tracker-taupe.vercel.app/api/webhook
```

**2. `TRACKER_WEBHOOK_SECRET`**
```
your-secret-token-here-change-me
```

**Generate a secure token:**
```bash
# On Linux/Mac
openssl rand -hex 32

# Or use any random string generator
```

### Step 2: Add the Secret to Vercel

Go to: https://vercel.com/prakash-pawar/deployment-tracker/settings/environment-variables

Add:
- **Key:** `WEBHOOK_SECRET`
- **Value:** (same token as `TRACKER_WEBHOOK_SECRET` above)
- **Environments:** Production, Preview, Development

Then redeploy:
```bash
cd /home/pawarpr/Desktop/WSL-Backup/deployment-tracker
vercel --prod
```

---

## 📝 Integration Methods

### Method 1: Add Reusable Workflow (Recommended)

**Step 1:** Add the log-deployment workflow to vidai-devops

Copy this file to: `vidai-devops/.github/workflows/log-deployment.yaml`

```yaml
# Copy from: /home/pawarpr/Desktop/WSL-Backup/deployment-tracker/log-deployment-workflow.yaml
```

**Step 2:** Call it from existing workflows

Add this job to `full_deployment.yaml` (after backend/frontend jobs):

```yaml
  # At the end of the workflow, after backend and frontend jobs
  log-deployment:
    needs: [config, backend, frontend]  # or whichever jobs complete the deployment
    if: always()  # Run even if previous jobs fail
    uses: ./.github/workflows/log-deployment.yaml
    with:
      environment: ${{ needs.config.outputs.environment_name }}  # Map cluster to env name
      status: ${{ job.status == 'success' && 'Success' || 'Failed' }}
      branch: ${{ github.event.inputs.branch_to_deploy }}
      version: ${{ github.event.inputs.image_tag }}
      requested_by: ${{ github.actor }}
      deployed_by: "GitHub Actions"
      ticket_link: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      notes: "Deploy type: ${{ github.event.inputs.deploy_to }}"
      started_at: ${{ github.event.workflow_run.created_at }}
    secrets:
      TRACKER_WEBHOOK_URL: ${{ secrets.TRACKER_WEBHOOK_URL }}
      TRACKER_WEBHOOK_SECRET: ${{ secrets.TRACKER_WEBHOOK_SECRET }}
```

---

### Method 2: Direct Webhook Call (Quick)

Add this step at the end of your deployment job:

```yaml
- name: Log to Deployment Tracker
  if: always()  # Run even if deployment fails
  run: |
    # Map cluster to environment name
    CLUSTER="${{ github.event.inputs.cluster }}"
    if [[ "$CLUSTER" == *"qa-aps"* ]]; then
      ENV="QA"
    elif [[ "$CLUSTER" == *"stage"* ]]; then
      ENV="Stage"
    elif [[ "$CLUSTER" == *"preview"* ]]; then
      ENV="Preview"
    elif [[ "$CLUSTER" == *"pre-prod"* ]]; then
      ENV="Pre-Prod"
    elif [[ "$CLUSTER" == *"production"* ]]; then
      ENV="Production"
    else
      ENV="Other"
    fi
    
    # Determine status
    STATUS="${{ job.status == 'success' && 'Success' || 'Failed' }}"
    
    # Send webhook
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
        "notes": "Deploy type: ${{ github.event.inputs.deploy_to }}",
        "started_at": "${{ github.event.workflow_run.created_at }}"
      }' \
      --silent --show-error || echo "⚠️ Failed to log deployment (non-blocking)"
```

---

## 🎯 Environment Name Mapping

Map your cluster names to environment names:

| Cluster | Environment |
|---------|-------------|
| `qa-aps-ecs-cluster` | **QA** |
| `vidai-solutions-stage-*` | **Stage** |
| `vidai-solutions-preview-99999-*` | **Preview** |
| `vidai-solutions-pre-prod-*` | **Pre-Prod** |
| `pre-prod-usw-ecs-cluster` | **Pre-Prod USW** |
| `production-aps-*` or `prod-refera-*` | **Production** |
| `lms-usw-*` | **LMS** |

Add this helper function to your workflows:

```yaml
- name: Map cluster to environment
  id: env
  run: |
    CLUSTER="${{ github.event.inputs.cluster }}"
    case "$CLUSTER" in
      *qa-aps*)           ENV="QA" ;;
      *stage*)            ENV="Stage" ;;
      *preview-99999*)    ENV="Preview" ;;
      *pre-prod-usw*)     ENV="Pre-Prod USW" ;;
      *pre-prod*)         ENV="Pre-Prod" ;;
      *production*|*prod-refera*) ENV="Production" ;;
      *lms*)              ENV="LMS" ;;
      *)                  ENV="Other" ;;
    esac
    echo "name=$ENV" >> $GITHUB_OUTPUT
```

---

## 📊 Example: Complete Integration

Here's a complete example of `full_deployment.yaml` with tracking:

```yaml
name: Deploy App
on:
  workflow_dispatch:
    inputs:
      cluster: ...
      deploy_to: ...
      # ... other inputs

jobs:
  config:
    # ... config job

  backend:
    needs: config
    # ... backend deployment
    
  frontend:
    needs: config
    # ... frontend deployment

  # NEW: Automatic deployment tracking
  track-deployment:
    needs: [config, backend, frontend]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Map cluster to environment
        id: env
        run: |
          CLUSTER="${{ github.event.inputs.cluster }}"
          case "$CLUSTER" in
            *qa-aps*)           ENV="QA" ;;
            *stage*)            ENV="Stage" ;;
            *preview-99999*)    ENV="Preview" ;;
            *pre-prod*)         ENV="Pre-Prod" ;;
            *production*)       ENV="Production" ;;
            *)                  ENV="Other" ;;
          esac
          echo "name=$ENV" >> $GITHUB_OUTPUT

      - name: Determine overall status
        id: status
        run: |
          if [[ "${{ needs.backend.result }}" == "success" ]] && [[ "${{ needs.frontend.result }}" == "success" ]]; then
            echo "result=Success" >> $GITHUB_OUTPUT
          elif [[ "${{ needs.backend.result }}" == "cancelled" ]] || [[ "${{ needs.frontend.result }}" == "cancelled" ]]; then
            echo "result=Cancelled" >> $GITHUB_OUTPUT
          else
            echo "result=Failed" >> $GITHUB_OUTPUT
          fi

      - name: Send to deployment tracker
        run: |
          curl -X POST "${{ secrets.TRACKER_WEBHOOK_URL }}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${{ secrets.TRACKER_WEBHOOK_SECRET }}" \
            -d '{
              "environment": "${{ steps.env.outputs.name }}",
              "status": "${{ steps.status.outputs.result }}",
              "branch": "${{ github.event.inputs.branch_to_deploy }}",
              "version": "${{ github.event.inputs.image_tag }}",
              "requested_by": "${{ github.actor }}",
              "deployed_by": "GitHub Actions",
              "ticket_link": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
              "notes": "Deploy: ${{ github.event.inputs.deploy_to }} to cluster ${{ github.event.inputs.cluster }}",
              "started_at": "${{ github.event.workflow_run.created_at || github.run_started_at }}"
            }' || true
```

---

## ✅ Testing the Integration

### 1. Test the Webhook Endpoint

```bash
curl -X POST https://deployment-tracker-taupe.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "environment": "QA",
    "status": "Success",
    "branch": "main",
    "version": "v1.0.0",
    "requested_by": "test-user",
    "deployed_by": "Manual Test",
    "started_at": "2026-08-27T10:00:00Z"
  }'
```

Expected response:
```json
{
  "success": true,
  "deployment": { ... }
}
```

### 2. Run a Test Deployment

Trigger a deployment in vidai-devops and check:
1. ✅ GitHub Actions completes
2. ✅ Webhook step succeeds
3. ✅ Deployment appears in tracker: https://deployment-tracker-taupe.vercel.app

---

## 🔍 Troubleshooting

### Webhook returns 401 Unauthorized
- Check that `WEBHOOK_SECRET` in Vercel matches `TRACKER_WEBHOOK_SECRET` in GitHub
- Verify the Authorization header format: `Bearer YOUR_TOKEN`

### Webhook returns 400 Bad Request
- Verify required fields: `environment`, `status`, `started_at`
- Check JSON format is valid

### Deployment doesn't appear in tracker
- Check GitHub Actions logs for the webhook step
- Verify the webhook URL is correct
- Check Vercel function logs: https://vercel.com/prakash-pawar/deployment-tracker/logs

### How to view Vercel logs
```bash
vercel logs https://deployment-tracker-taupe.vercel.app/api/webhook --follow
```

---

## 📈 Monitoring

### View Deployments
**Dashboard:** https://deployment-tracker-taupe.vercel.app

**API:**
```bash
# List recent deployments
curl https://deployment-tracker-taupe.vercel.app/api/deployments

# Filter by environment
curl https://deployment-tracker-taupe.vercel.app/api/deployments?environment=Production
```

---

## 🚀 What's Next

After integration:
- ✅ Every deployment is automatically logged
- ✅ Real-time dashboard updates
- ✅ Full deployment history
- ✅ API access for reporting
- ✅ No manual entry needed!

**Future Enhancements:**
- Add Slack notifications on deployment
- Email alerts for failed deployments
- Deployment analytics and metrics
- Integration with monitoring tools

---

## 📝 Files Reference

1. **Webhook API:** `/home/pawarpr/Desktop/WSL-Backup/deployment-tracker/app/api/webhook/route.ts`
2. **Reusable Workflow:** `/home/pawarpr/Desktop/WSL-Backup/deployment-tracker/log-deployment-workflow.yaml`
3. **This Guide:** `/home/pawarpr/Desktop/WSL-Backup/deployment-tracker/AUTOMATIC_TRACKING.md`

---

**Questions?** Check the main README or deployment tracker dashboard!
