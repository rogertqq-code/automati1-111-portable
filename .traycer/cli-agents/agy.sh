#!/bin/sh

# CLI Agent Template
# Available environment variables:
#   $TRAYCER_PROMPT - The prompt to be executed (environment variable set by Traycer at runtime)
#   $TRAYCER_PROMPT_TMP_FILE - Temporary file path containing the prompt content - useful for large prompts that exceed environment variable limits. Use commands like `cat $TRAYCER_PROMPT_TMP_FILE` to read and pass the prompt content to the CLI agent at runtime.
#        Example: cat $TRAYCER_PROMPT_TMP_FILE | CLI_AGENT_NAME
#   $TRAYCER_TASK_ID - Traycer task identifier - use this when you want to use the same session on the execution agent across phase iterations, plans, and verification execution
#   $TRAYCER_PHASE_BREAKDOWN_ID - Traycer phase breakdown identifier - use this when you want to use the same session for the current list of phases
#   $TRAYCER_PHASE_ID - Traycer per phase identifier - use this when you want to use the same session for plan/review and verification
#   $TRAYCER_SYSTEM_PROMPT - System prompt to append to the CLI agent (environment variable set by Traycer at runtime). Use this with --append-system-prompt or equivalent flag to pass trusted instructions at the system level.

echo "$TRAYCER_PROMPT"
