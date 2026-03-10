import { TodoistApi } from "@doist/todoist-api-typescript";
import {
  GetCompletedTasksArgs,
} from "../../types/index.js";
import { AuthenticationError, TodoistAPIError, ValidationError } from "../../errors.js";
import {
  validateLimit,
  validateProjectId,
  VALIDATION_LIMITS,
} from "../../validation/index.js";
import { extractApiToken } from "../../utils/api-helpers.js";
import { ErrorHandler } from "../../utils/error-handling.js";

interface CompletedTaskV1 {
  id: string;
  content: string;
  project_id: string;
  section_id?: string;
  completed_at: string;
  task_id: string;
}

interface CompletedTasksV1Response {
  items: CompletedTaskV1[];
  next_cursor: string | null;
}

/**
 * Ensures a date string is in full ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ).
 * Accepts YYYY-MM-DD and appends T00:00:00Z if needed.
 */
function toIsoDatetime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00Z`;
  }
  return value;
}

/**
 * Fetches completed tasks from the Todoist API v1.
 */
export async function handleGetCompletedTasks(
  todoistClient: TodoistApi,
  args: GetCompletedTasksArgs
): Promise<string> {
  return ErrorHandler.wrapAsync("get completed tasks", async () => {
    validateLimit(args.limit, VALIDATION_LIMITS.SYNC_API_LIMIT_MAX);
    validateProjectId(args.project_id);

    // v1 API requires since and until
    if (!args.since || !args.until) {
      throw new ValidationError(
        "Both 'since' and 'until' are required for the completed tasks endpoint. Use ISO 8601 format (e.g. 2026-03-01T00:00:00Z or 2026-03-01)."
      );
    }

    if (process.env.DRYRUN === "true") {
      console.error("[DRY-RUN] Would fetch completed tasks from API v1");
      console.error(
        `[DRY-RUN] Parameters: projectId=${args.project_id || "all"}, since=${args.since}, until=${args.until}, limit=${args.limit || 200}`
      );
      return "DRY-RUN: Would retrieve completed tasks from Todoist API v1. No actual API call made.";
    }

    const apiToken = extractApiToken(todoistClient);

    const params = new URLSearchParams();
    params.append("since", toIsoDatetime(args.since));
    params.append("until", toIsoDatetime(args.until));
    if (args.project_id) {
      params.append("project_id", args.project_id);
    }
    if (args.limit !== undefined) {
      params.append("limit", args.limit.toString());
    }
    if (args.cursor) {
      params.append("cursor", args.cursor);
    }

    const queryString = params.toString();
    const url = `https://api.todoist.com/api/v1/tasks/completed/by_completion_date?${queryString}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new AuthenticationError();
      } else if (response.status === 403) {
        throw new TodoistAPIError(
          "Access denied. Completed tasks may require Todoist Premium."
        );
      }
      throw new TodoistAPIError(
        `Completed tasks API error (${response.status}): ${errorText}`
      );
    }

    const data: CompletedTasksV1Response = await response.json();

    if (!data.items || data.items.length === 0) {
      return "No completed tasks found matching the criteria.";
    }

    const taskCount = data.items.length;
    const taskWord = taskCount === 1 ? "task" : "tasks";

    let result = `${taskCount} completed ${taskWord} found:\n\n`;

    for (const item of data.items) {
      const completedDate = item.completed_at?.split("T")[0] ?? "unknown";

      result += `- ${item.content}\n`;
      result += `  Completed: ${completedDate}\n`;
      result += `  Project ID: ${item.project_id}\n`;
      result += "\n";
    }

    if (data.next_cursor) {
      result += `\nMore results available. Use cursor: "${data.next_cursor}" to fetch the next page.`;
    }

    return result.trim();
  });
}
