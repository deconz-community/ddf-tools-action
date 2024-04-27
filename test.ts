import { Octokit } from "@octokit/action";
import * as github from "@actions/github";

const octokit = new Octokit();

async function run() {
    const payload = github.context.payload;
    const commentBody = payload.comment?.body;
    const issueNumber = payload.issue?.number;
    const repoName = payload.repository?.name;
    const repoOwner = payload.repository?.owner.login;
  
    if (commentBody?.includes('ping')) {
      await octokit.rest.issues.createComment({
        owner: repoOwner!,
        repo: repoName!,
        issue_number: issueNumber!,
        body: 'pong'
      });
    }
}

run();