import json, random, sys
from collections import deque, Counter, OrderedDict
import heapq

random.seed(42)
P = []

def add(pid, title, difficulty, tags, statement, ref, samples, hidden):
    def run(inp):
        return ref(inp).strip()
    P.append({
        "id": pid, "title": title, "difficulty": difficulty, "tags": tags,
        "statement": statement.strip(),
        "samples": [{"input": s, "output": run(s)} for s in samples],
        "hidden": [{"input": h, "output": run(h)} for h in hidden],
    })

# 1 two sum
def two_sum(inp):
    l = inp.split("\n"); n, t = map(int, l[0].split()); a = list(map(int, l[1].split()))
    seen = {}
    for j, x in enumerate(a):
        if t - x in seen: return f"{seen[t-x]} {j}"
        if x not in seen: seen[x] = j
    return "-1 -1"
def ts_case(n, solvable=True):
    a = [random.randint(-1000, 1000) for _ in range(n)]
    if solvable:
        i, j = sorted(random.sample(range(n), 2)); t = a[i] + a[j]
    else:
        t = 10**6
    return f"{n} {t}\n{' '.join(map(str,a))}"
add("two-sum", "Pair With Target Sum", "easy", ["arrays", "hashing", "general"],
"""
Given an array of `n` integers and a target `t`, find two **different** indices `i < j` such that `a[i] + a[j] = t`.
If several pairs exist, choose the one with the **smallest j**, and for that `j` the **smallest i**. If no pair exists print `-1 -1`.

**Input**
- Line 1: `n t`
- Line 2: `n` space-separated integers

**Output**
- `i j` (0-indexed)

**Constraints:** 2 ≤ n ≤ 200000, |a[i]|, |t| ≤ 10^9. Aim for O(n).
""", two_sum, ["5 9\n2 7 11 15 1", "4 100\n1 2 3 4"], [ts_case(10), ts_case(1000), ts_case(50, False), "2 0\n0 0", "6 4\n2 2 2 2 2 2", ts_case(5000)])

# 2 brackets
def brackets(inp):
    s = inp.strip(); st = []; pairs = {')':'(', ']':'[', '}':'{'}
    for c in s:
        if c in '([{': st.append(c)
        elif c in pairs:
            if not st or st[-1] != pairs[c]: return "NO"
            st.pop()
    return "YES" if not st else "NO"
def rand_br(n, valid):
    if valid:
        s=[]; st=[]
        for _ in range(n):
            if st and random.random()<0.5:
                s.append({'(':')','[':']','{':'}'}[st.pop()])
            else:
                c=random.choice('([{'); st.append(c); s.append(c)
        while st: s.append({'(':')','[':']','{':'}'}[st.pop()])
        return ''.join(s)
    return ''.join(random.choice('()[]{}') for _ in range(n))
add("balanced-brackets", "Balanced Brackets", "easy", ["stack", "strings", "general"],
"""
Given a string containing only the characters `()[]{}`, print `YES` if every bracket is closed by the same type of bracket in the correct order, otherwise `NO`.

**Input:** one line, the string (length 1 – 100000).

**Output:** `YES` or `NO`.
""", brackets, ["([]{})", "([)]"], [rand_br(1000, True), rand_br(1000, False), "(", "}{", rand_br(5000, True), "(((())))[]"])

# 3 top-k words
def topk(inp):
    l = inp.split("\n"); k = int(l[0]); words = " ".join(l[1:]).lower().split()
    c = Counter(words)
    return "\n".join(f"{w} {n}" for w, n in sorted(c.items(), key=lambda x: (-x[1], x[0]))[:k])
vocab = ["api","cache","queue","latency","error","retry","db","index","user","order","payment","shard"]
def tk_case(n,k): return f"{k}\n" + " ".join(random.choice(vocab) for _ in range(n))
add("top-k-words", "Top K Frequent Words", "easy", ["hashing", "sorting", "data"],
"""
Given an integer `k` and a text, print the `k` most frequent words with their counts. Words are separated by whitespace and compared **case-insensitively** (output in lowercase).
Order by count descending, then alphabetically. If there are fewer than `k` distinct words, print them all.

**Input**
- Line 1: `k`
- Remaining lines: the text

**Output:** one `word count` per line.
""", topk, ["2\nthe cat the dog THE cat", "3\napi api cache"], [tk_case(100,3), tk_case(2000,5), "1\nx", tk_case(20,20), tk_case(3000,1)])

# 4 merge intervals
def merge(inp):
    l = inp.split("\n"); n = int(l[0]); iv = sorted(tuple(map(int, x.split())) for x in l[1:n+1])
    out = []
    for s, e in iv:
        if out and s <= out[-1][1]: out[-1][1] = max(out[-1][1], e)
        else: out.append([s, e])
    return "\n".join(f"{s} {e}" for s, e in out)
def mi_case(n):
    rows=[]
    for _ in range(n):
        s=random.randint(0,10000); rows.append(f"{s} {s+random.randint(0,300)}")
    return f"{n}\n" + "\n".join(rows)
add("merge-intervals", "Merge Booking Intervals", "medium", ["sorting", "intervals", "backend"],
"""
You are given `n` closed time intervals `[start, end]` (bookings). Merge all overlapping or touching intervals (`[1,3]` and `[3,5]` merge into `[1,5]`) and print the result sorted by start.

**Input**
- Line 1: `n`
- Next `n` lines: `start end` (0 ≤ start ≤ end ≤ 10^9)

**Output:** one merged `start end` per line.
""", merge, ["4\n1 3\n2 6\n8 10\n15 18", "2\n1 4\n4 5"], [mi_case(10), mi_case(1000), "1\n5 5", mi_case(3000), "3\n1 10\n2 3\n4 5"])

# 5 rate limiter
def rate(inp):
    l = inp.split("\n"); L, W, n = map(int, l[0].split())
    hist = {}; out = []
    for x in l[1:n+1]:
        u, t = x.split(); t = int(t)
        q = hist.setdefault(u, deque())
        while q and q[0] <= t - W: q.popleft()
        if len(q) < L: q.append(t); out.append("ALLOW")
        else: out.append("DENY")
    return "\n".join(out)
def rl_case(n, L, W):
    t=0; rows=[]
    for _ in range(n):
        t += random.randint(0,3); rows.append(f"{random.choice(['u1','u2','u3'])} {t}")
    return f"{L} {W} {n}\n" + "\n".join(rows)
add("rate-limiter", "Sliding Window Rate Limiter", "medium", ["queues", "design", "backend"],
"""
Implement a per-user sliding-window rate limiter. A request from user `u` at time `t` is **allowed** if fewer than `L` of that user's previously *allowed* requests happened in the window `(t - W, t]`. Denied requests do not count.

**Input**
- Line 1: `L W n`
- Next `n` lines: `user timestamp` (timestamps are non-decreasing integers)

**Output:** for each request, `ALLOW` or `DENY` on its own line.
""", rate, ["2 10 5\na 1\na 2\na 3\nb 3\na 11", "1 5 3\nx 0\nx 5\nx 9"], [rl_case(20,3,5), rl_case(2000,5,10), rl_case(3000,10,100), "1 1 3\na 1\na 1\na 2"])

# 6 LRU cache
def lru(inp):
    l = inp.split("\n"); cap, n = map(int, l[0].split()); c = OrderedDict(); out=[]
    for x in l[1:n+1]:
        p = x.split()
        if p[0] == "GET":
            k = p[1]
            if k in c: c.move_to_end(k); out.append(c[k])
            else: out.append("-1")
        else:
            k, v = p[1], p[2]
            if k in c: c.move_to_end(k)
            c[k] = v
            if len(c) > cap: c.popitem(last=False)
    return "\n".join(out)
def lru_case(n, cap):
    rows=[]
    for _ in range(n):
        k=f"k{random.randint(1,cap*2)}"
        rows.append(f"GET {k}" if random.random()<0.5 else f"PUT {k} {random.randint(1,999)}")
    if not any(r.startswith("GET") for r in rows): rows.append("GET k1")
    return f"{cap} {len(rows)}\n" + "\n".join(rows)
add("lru-cache", "LRU Cache", "medium", ["design", "hashing", "backend"],
"""
Simulate a Least-Recently-Used cache with capacity `C`.
- `PUT key value` inserts or updates a key (and marks it most recently used). If the cache exceeds `C` entries, evict the least recently used key.
- `GET key` prints the value or `-1` if absent (and marks it most recently used when present).

**Input**
- Line 1: `C n`
- Next `n` lines: operations

**Output:** one line per `GET`. Target O(1) per operation.
""", lru, ["2 6\nPUT a 1\nPUT b 2\nGET a\nPUT c 3\nGET b\nGET c"], [lru_case(30,3), lru_case(5000,50), lru_case(5000,200), "1 3\nPUT a 1\nPUT a 2\nGET a"])

# 7 longest unique substring
def lus(inp):
    s = inp.strip("\n"); last = {}; best = st = 0
    for i, ch in enumerate(s):
        if ch in last and last[ch] >= st: st = last[ch] + 1
        last[ch] = i; best = max(best, i - st + 1)
    return str(best)
add("longest-unique-substring", "Longest Substring Without Repeats", "medium", ["strings", "sliding-window", "general"],
"""
Print the length of the longest substring of `s` that contains no repeated characters.

**Input:** one line, the string `s` (1 ≤ |s| ≤ 200000, printable ASCII without spaces).

**Output:** an integer.
""", lus, ["abcabcbb", "bbbbb"], ["pwwkew", "a", "".join(random.choice("abcdefghij") for _ in range(3000)), "".join(chr(33+i%90) for i in range(5000)), "abba"])

# 8 grid shortest path
def grid(inp):
    l = inp.split("\n"); r, c = map(int, l[0].split()); g = l[1:r+1]
    if g[0][0] == '#' or g[r-1][c-1] == '#': return "-1"
    d = [[-1]*c for _ in range(r)]; d[0][0]=0; q=deque([(0,0)])
    while q:
        y,x=q.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=y+dy,x+dx
            if 0<=ny<r and 0<=nx<c and g[ny][nx]=='.' and d[ny][nx]<0:
                d[ny][nx]=d[y][x]+1; q.append((ny,nx))
    return str(d[r-1][c-1])
def grid_case(r,c,p):
    rows=["".join('#' if random.random()<p else '.' for _ in range(c)) for _ in range(r)]
    rows[0]='.'+rows[0][1:]; rows[-1]=rows[-1][:-1]+'.'
    return f"{r} {c}\n" + "\n".join(rows)
add("grid-shortest-path", "Warehouse Robot Shortest Path", "medium", ["graphs", "bfs", "general"],
"""
A robot starts at the top-left cell of an `R × C` grid and must reach the bottom-right cell, moving up/down/left/right through open cells (`.`), never through walls (`#`). Print the minimum number of moves, or `-1` if impossible.

**Input**
- Line 1: `R C` (1 ≤ R, C ≤ 1000)
- Next `R` lines: the grid

**Output:** an integer.
""", grid, ["3 3\n...\n.#.\n...", "2 2\n.#\n#."], [grid_case(10,10,0.2), grid_case(80,80,0.3), grid_case(120,120,0.1), "1 1\n.", grid_case(50,50,0.45)])

# 9 reconciliation
def recon(inp):
    l = inp.split("\n"); n, m = map(int, l[0].split())
    A = dict(x.split() for x in l[1:n+1]); B = dict(x.split() for x in l[n+1:n+1+m])
    out=[]
    for k in sorted(set(A)|set(B)):
        if k not in B: out.append(f"{k} MISSING_IN_BANK")
        elif k not in A: out.append(f"{k} MISSING_IN_LEDGER")
        elif A[k] != B[k]: out.append(f"{k} AMOUNT_MISMATCH {A[k]} {B[k]}")
    return "\n".join(out) if out else "OK"
def rc_case(n):
    ids=[f"T{i:05d}" for i in random.sample(range(99999), n)]
    A={i:str(random.randint(1,100000)) for i in ids}; B=dict(A)
    for i in random.sample(ids, max(1,n//10)):
        r=random.random()
        if r<0.33: del B[i]
        elif r<0.66: B[i]=str(int(B[i])+1)
        else: del A[i]
    B[f"X{random.randint(0,999):03d}"]="5"
    return f"{len(A)} {len(B)}\n" + "\n".join(f"{k} {v}" for k,v in A.items()) + "\n" + "\n".join(f"{k} {v}" for k,v in B.items())
add("reconciliation", "Ledger vs Bank Reconciliation", "medium", ["hashing", "sorting", "fintech", "data"],
"""
Reconcile a ledger against a bank statement. Each record is `txn_id amount` (amount is an integer in paise/cents).
For every transaction id in either list, sorted by id (string order), print a line when there is a problem:
- `id MISSING_IN_BANK` — in ledger only
- `id MISSING_IN_LEDGER` — in bank only
- `id AMOUNT_MISMATCH ledgerAmount bankAmount`

If everything matches print `OK`.

**Input**
- Line 1: `n m`
- Next `n` lines: ledger records; next `m` lines: bank records
""", recon, ["3 3\nT1 100\nT2 250\nT3 75\nT1 100\nT2 200\nT4 10", "1 1\nA 5\nA 5"], [rc_case(10), rc_case(1000), rc_case(2000)])

# 10 meeting rooms
def rooms(inp):
    l = inp.split("\n"); n = int(l[0]); iv = sorted(tuple(map(int, x.split())) for x in l[1:n+1])
    h=[]; best=0
    for s,e in iv:
        while h and h[0] <= s: heapq.heappop(h)
        heapq.heappush(h, e); best=max(best,len(h))
    return str(best)
def mr_case(n):
    rows=[]
    for _ in range(n):
        s=random.randint(0,1000); rows.append(f"{s} {s+random.randint(1,120)}")
    return f"{n}\n" + "\n".join(rows)
add("meeting-rooms", "Minimum Meeting Rooms", "medium", ["heaps", "intervals", "general"],
"""
Given `n` meetings as half-open intervals `[start, end)`, print the minimum number of rooms required so that no two overlapping meetings share a room. A meeting ending at time `t` frees its room for a meeting starting at `t`.

**Input**
- Line 1: `n`
- Next `n` lines: `start end` (start < end)

**Output:** an integer.
""", rooms, ["3\n0 30\n5 10\n15 20", "2\n7 10\n2 4"], [mr_case(10), mr_case(1000), mr_case(5000), "3\n1 5\n5 10\n10 15"])

# 11 topo order
def topo(inp):
    l = inp.split("\n"); n, m = map(int, l[0].split())
    adj=[[] for _ in range(n)]; indeg=[0]*n
    for x in l[1:m+1]:
        a,b=map(int,x.split()); adj[a].append(b); indeg[b]+=1
    h=[i for i in range(n) if indeg[i]==0]; heapq.heapify(h); out=[]
    while h:
        u=heapq.heappop(h); out.append(u)
        for v in adj[u]:
            indeg[v]-=1
            if indeg[v]==0: heapq.heappush(h,v)
    return " ".join(map(str,out)) if len(out)==n else "CYCLE"
def topo_case(n, m, cyc=False):
    perm=list(range(n)); random.shuffle(perm); edges=set()
    while len(edges)<m:
        a,b=sorted(random.sample(range(n),2)); edges.add((perm[a],perm[b]))
    edges=list(edges)
    if cyc: a,b=edges[0]; edges.append((b,a))
    return f"{n} {len(edges)}\n" + "\n".join(f"{a} {b}" for a,b in edges)
add("build-order", "Service Build Order", "hard", ["graphs", "topological-sort", "devops", "backend"],
"""
There are `n` services numbered `0..n-1` and `m` dependencies `a b` meaning service `a` must be built before service `b`.
Print a valid build order. When several services are ready at the same time, build the **smallest number first** (so the answer is unique). If the dependencies contain a cycle, print `CYCLE`.

**Input**
- Line 1: `n m`
- Next `m` lines: `a b`

**Output:** the order as space-separated numbers, or `CYCLE`.
""", topo, ["4 3\n0 1\n1 2\n0 3", "2 2\n0 1\n1 0"], [topo_case(10,12), topo_case(1000,3000), topo_case(50,60,True), "3 0\n", topo_case(2000,5000)])

# 12 sliding window max
def swmax(inp):
    l = inp.split("\n"); n,k=map(int,l[0].split()); a=list(map(int,l[1].split())); dq=deque(); out=[]
    for i,x in enumerate(a):
        while dq and a[dq[-1]]<=x: dq.pop()
        dq.append(i)
        if dq[0]<=i-k: dq.popleft()
        if i>=k-1: out.append(a[dq[0]])
    return " ".join(map(str,out))
def sw_case(n,k): return f"{n} {k}\n" + " ".join(str(random.randint(-10**6,10**6)) for _ in range(n))
add("sliding-window-max", "Peak Load in Sliding Window", "hard", ["deque", "sliding-window", "devops", "data"],
"""
Given per-second request counts `a[0..n-1]` and a window size `k`, print the maximum value in every window of `k` consecutive seconds. Target O(n).

**Input**
- Line 1: `n k` (1 ≤ k ≤ n ≤ 500000)
- Line 2: `n` integers

**Output:** `n - k + 1` space-separated maxima.
""", swmax, ["8 3\n1 3 -1 -3 5 3 6 7", "1 1\n5"], [sw_case(10,2), sw_case(1000,10), sw_case(8000,100), sw_case(50,50)])

json.dump(P, open(sys.argv[1], "w"), indent=1)
print(len(P), "problems;", sum(len(p["hidden"]) for p in P), "hidden tests")
