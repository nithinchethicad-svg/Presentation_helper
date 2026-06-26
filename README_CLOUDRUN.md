# Google Cloud Run Deployment Guide

This guide walks you through the step-by-step process of deploying your Takeaway Presentation Assistant to **Google Cloud Run** with persistent storage powered by **Google Cloud Storage (GCS)**.

---

## 📋 Prerequisites

1. **Google Cloud Account**: A GCP project with billing enabled (Cloud Run has an Always Free tier, but billing must be enabled to use it).
2. **Google Cloud CLI (gcloud)**: Download and install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) on your computer.
3. **Initialize the CLI**:
   Run the following command in your terminal to authenticate and set your active project:
   ```bash
   gcloud init
   ```

---

## 🛠️ Step 1: Create a Google Cloud Storage (GCS) Bucket

Because Cloud Run containers are serverless and restart frequently, any files stored on the local hard drive (like disabled keys, session logs, and monthly aggregates) will be lost. To prevent this, our system automatically syncs these files with a GCS bucket.

1. Run the following command in your terminal to create a private storage bucket (replace `my-takeaway-storage-bucket` with a unique name of your choice):
   ```bash
   gcloud storage buckets create gs://my-takeaway-storage-bucket --location=asia-south1
   ```
   *(Note: You can change the location to your preferred region, e.g., `us-central1` or `europe-west1`).*

---

## 📦 Step 2: Deploy to Google Cloud Run

To build your application into a container and deploy it to the cloud, run the following single command from the root of your project:

```bash
gcloud run deploy takeaway-assistant \
  --source . \
  --allow-unauthenticated \
  --region asia-south1 \
  --set-env-vars="NODE_ENV=production,DEVTOOLS_ADMIN_PASSWORD=admin,GCS_BUCKET_NAME=my-takeaway-storage-bucket"
```

### What this command does:
1. `--source .`: Uploads your code and uses Google's Cloud Build to build the Docker image automatically (using our `Dockerfile` at the root).
2. `--allow-unauthenticated`: Makes the website public so users can visit it.
3. `--set-env-vars`: Passes critical configuration variables:
   - `NODE_ENV=production`: Activates production mode, securing all `/api/devtools/*` endpoints and prompting for the admin password.
   - `DEVTOOLS_ADMIN_PASSWORD=admin`: Sets the password required to access the DevTools portal (change `"admin"` to a strong password of your choice!).
   - `GCS_BUCKET_NAME=my-takeaway-storage-bucket`: Points the application to your GCS bucket. The app will automatically sync `disabled_keys.json`, `usage_history.json`, and `monthly_aggregates.json` to this bucket.

---

## 🔑 Step 3: Grant Storage Permissions to Cloud Run (Important!)

For Cloud Run to read and write files in your GCS bucket, you must grant it permission:

1. **Find the Service Account**:
   - Go to the **Google Cloud Console** web page.
   - Search for **Cloud Run** and click on your deployed service (`takeaway-assistant`).
   - Look at the **Security** or **Details** tab and copy the **Service Account email** (it usually looks like `[project-number]-compute@developer.gserviceaccount.com` or `takeaway-assistant@[project-id].iam.gserviceaccount.com`).

2. **Grant the Role**:
   - Go to **Cloud Storage** in the console and click on your bucket (`my-takeaway-storage-bucket`).
   - Go to the **Permissions** tab and click **Grant Access** (or **Add Principal**).
   - Paste the Service Account email in the "New principals" box.
   - Under "Select a role", choose **Cloud Storage** ➔ **Storage Object Admin** (this allows the app to read, write, and delete files in the bucket).
   - Click **Save**.

---

## 🎉 Your App is Live!

Once the deployment finishes, the terminal will output a **Service URL** (e.g., `https://takeaway-assistant-xxxxx-as.a.run.app`).
* Open this URL in your browser to access your AI Presentation Assistant.
* Navigate to the URL + `#/devtools` to access the developer dashboard. Enter your configured admin password to log in!
