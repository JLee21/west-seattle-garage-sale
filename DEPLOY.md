# Deploy to DigitalOcean App Platform

1. Create a Git repository on GitHub or GitLab and push this project (branch `main` or `master`).
2. In the [DigitalOcean control panel](https://cloud.digitalocean.com/apps), choose **Create** → **Apps**.
3. Connect your Git provider, select this repository and branch.
4. App Platform should detect a **Static Site** with an `index.html` at the repo root. Use the **HTML** buildpack / static site component if prompted.
5. Set the app **region** as you prefer, confirm the plan, and **Launch**.
6. After deploy, open the live URL and confirm the page, favicon, and chat widget.

Optional: use [`doctl`](https://docs.digitalocean.com/reference/doctl/reference/apps/) with [`.do/app.yaml`](.do/app.yaml) — replace the `github` block with your repo when you add App Platform’s generated source section, or create the app from the UI first and export the spec.
