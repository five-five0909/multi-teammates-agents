from __future__ import annotations

import json
import sys
import time


mode = sys.argv[1]
prompt = sys.stdin.read()
if mode == "sleep":
    time.sleep(30)
elif mode == "malformed":
    print("not-json", flush=True)
elif mode == "permission":
    print(json.dumps({"type": "permission", "id": "permission-1"}), flush=True)
    sys.exit(2)
else:
    print(json.dumps({"type": "started", "id": "start-1"}), flush=True)
    print(
        json.dumps(
            {
                "type": "result",
                "id": "result-1",
                "text": json.dumps({"prompt": prompt, "ok": True}),
            }
        ),
        flush=True,
    )

