"""
Live entrypoint for the Embodiment Cluster.

SAFETY DEFAULTS:
  - starts in DRY-RUN (visualizes intent, moves nothing)
  - arms kill listeners before anything
  - requires an explicit --live flag AND a typed confirmation to actuate

Kill at any time: triple-tap ESC, or slam the cursor to the top-left corner.

  export ANTHROPIC_API_KEY=...
  python run_live.py "open the notes app and write 'hello from neuralscope'"
  python run_live.py --live "..."   # actually moves the cursor (asks to confirm)
"""
import sys
from embodiment.cluster import EmbodimentCluster


def pretty(evt):
    d = evt["data"]
    bits = " ".join(f"{k}={v}" for k, v in d.items() if v not in (None, "", []))
    print(f"  [{evt['type']}] {bits}")


def main():
    args = [a for a in sys.argv[1:]]
    live = "--live" in args
    args = [a for a in args if a != "--live"]
    objective = args[0] if args else "take a screenshot and describe what you see"

    cluster = EmbodimentCluster(dry_run=not live)
    cluster.subscribe(pretty)
    cluster.arm()

    if live:
        print("\n⚠  LIVE MODE will move your real mouse and keyboard.")
        print("   Kill: triple-ESC or cursor to top-left corner.")
        if input("   Type 'I understand' to proceed: ").strip() != "I understand":
            print("   Aborted. Staying in dry-run.")
        else:
            cluster.go_live()

    print(f"\nObjective: {objective}\n" + "-" * 60)
    result = cluster.run(objective)
    print("-" * 60)
    print("Status:", result.get("status"))


if __name__ == "__main__":
    main()
