#!/usr/bin/env python3
import json
import urllib.request

def login(base: str, password: str) -> str:
    req = urllib.request.Request(
        f"{base}/auth/login",
        data=json.dumps({"nickname": "director", "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["token"]

def get(base: str, token: str, path: str):
    req = urllib.request.Request(
        f"{base}/{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

for name, base, pwd in [
    ("Render", "https://sales-platform-1.onrender.com", "Bufet000"),
    ("Timeweb", "http://77.233.223.48", "Foto-2026-9kLq"),
]:
    print(f"\n=== {name} ===")
    try:
        tok = login(base, pwd)
        sales = get(base, tok, "admin/sales")
        fin = get(base, tok, "admin/finance/ops")
        staff = get(base, tok, "admin/staff")
        print("sales:", len(sales))
        print("staff:", len(staff))
        print("finance expenses:", len(fin.get("expenses", [])))
        print("finance incomes:", len(fin.get("incomes", [])))
        print("account balance sum:", sum(a.get("balance", 0) for a in fin.get("accounts", [])))
    except Exception as e:
        print("ERROR:", e)
