#!/usr/bin/env bash
# Run a small real SWE-bench sympy subset in WSL with the task's test/gold patches.
# This is a measurement harness, not the official SWE-bench evaluator.
set -u

TASKS_ROOT="${TASKS_ROOT:-/mnt/c/Users/冯宗弘/AppData/Local/wsl/swe-bench-tasks-unzipped/swe-bench-tasks-main/tasks}"
REPO="${REPO:-/opt/sympy}"
CONDA="${CONDA:-/opt/miniconda3/bin/conda}"
ENV_NAME="${ENV_NAME:-py39}"
ENV_PREFIX="${ENV_PREFIX:-}"

run_conda() {
  if [ -n "$ENV_PREFIX" ]; then
    "$CONDA" run -p "$ENV_PREFIX" "$@"
  else
    "$CONDA" run -n "$ENV_NAME" "$@"
  fi
}
TASKS=(
  sympy__sympy-11232
  sympy__sympy-11384
  sympy__sympy-11400
  sympy__sympy-11438
  sympy__sympy-11618
  sympy__sympy-11787
  sympy__sympy-11788
  sympy__sympy-11794
  sympy__sympy-11818
  sympy__sympy-11831
)

summary_line() {
  local log="$1"
  grep -E 'tests finished:' "$log" | tail -1 | tr -d '\r' || true
}

count_field() {
  local line="$1" field="$2"
  echo "$line" | sed -n "s/.* \([0-9][0-9]*\) $field.*/\1/p" | head -1
}

cd "$REPO" || exit 2
printf 'task\tphase\tfailed\texceptions\tpassed\texit\tsummary\n'

for id in "${TASKS[@]}"; do
  task_dir="$TASKS_ROOT/$id"
  if [ ! -f "$task_dir/task.yaml" ]; then
    printf '%s\tmissing\t\t\t\t\t\n' "$id"
    continue
  fi
  base=$(grep '^base_commit:' "$task_dir/task.yaml" | awk '{print $2}')
  if git cat-file -e "$base^{commit}" 2>/dev/null; then
    git checkout -q -f "$base"
  else
    if ! git fetch --depth 1 origin "$base" >/dev/null 2>&1; then
      printf '%s\tfetch-failed\t\t\t\t\t%s\n' "$id" "$base"
      continue
    fi
    git checkout -q -f FETCH_HEAD
  fi
  git clean -fdq
  if ! git apply "$task_dir/test.patch" 2>/tmp/"$id"-apply.log; then
    printf '%s\ttest-patch-failed\t\t\t\t\t%s\n' "$id" "$(tail -1 /tmp/"$id"-apply.log)"
    continue
  fi
  cmd=$(grep -E 'bin/test' "$task_dir/eval.sh" | tail -1 | sed 's/^.* bin\/test/bin\/test/')
  cmd=${cmd/bin\/test/python bin\/test}
  for phase in no-gold gold; do
    if [ "$phase" = gold ]; then
      if ! git apply "$task_dir/gold.patch" 2>/tmp/"$id"-gold-apply.log; then
        printf '%s\tgold-apply-failed\t\t\t\t\t%s\n' "$id" "$(tail -1 /tmp/"$id"-gold-apply.log)"
        break
      fi
    fi
    log=/tmp/"$id"-"$phase".log
    run_conda bash -lc "cd '$REPO'; ${cmd}" >"$log" 2>&1
    code=$?
    line=$(summary_line "$log")
    failed=$(count_field "$line" failed); failed=${failed:-0}
    exceptions=$(count_field "$line" exceptions); exceptions=${exceptions:-0}
    passed=$(count_field "$line" passed); passed=${passed:-0}
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$phase" "$failed" "$exceptions" "$passed" "$code" "$line"
  done
  git reset --hard -q
  git clean -fdq
done
