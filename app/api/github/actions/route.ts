import { NextRequest, NextResponse } from "next/server";

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  runNumber: number;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: "success" | "failure" | "cancelled" | "timed_out" | null | string;
  event: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  commitMessage?: string;
}

export async function GET(request: NextRequest) {
  try {
    const owner = process.env.GITHUB_REPOSITORY_OWNER || "s-afrid";
    const repo = process.env.GITHUB_REPOSITORY_NAME || "trakt-sync-engine";
    const workflow = "letterboxd-sync.yml";

    const headers: Record<string, string> = {
      "User-Agent": "TraktSyncEngine/1.0",
      Accept: "application/vnd.github+json",
    };

    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?per_page=5`;
    const res = await fetch(url, {
      headers,
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `GitHub API error: ${res.statusText}`,
          runs: [],
        },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rawRuns = data.workflow_runs || [];

    const runs: GitHubWorkflowRun[] = rawRuns.map((r: any) => ({
      id: r.id,
      name: r.name,
      runNumber: r.run_number,
      status: r.status,
      conclusion: r.conclusion,
      event: r.event,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      htmlUrl: r.html_url,
      commitMessage: r.head_commit?.message?.split("\n")[0] || "",
    }));

    const latestRun = runs[0] || null;

    return NextResponse.json({
      success: true,
      repo: `${owner}/${repo}`,
      workflow,
      totalRuns: data.total_count || 0,
      latestRun,
      runs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: msg,
        runs: [],
      },
      { status: 500 }
    );
  }
}
