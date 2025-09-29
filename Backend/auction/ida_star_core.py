# app/auction/ida_star_core.py
# Generic IDA* implementation (domain-agnostic).
from math import inf
from typing import Any, Callable, Iterable, Tuple, Optional, List

State = Any

def ida_star(
    start: State,
    h: Callable[[State], float],
    expand: Callable[[State], Iterable[Tuple[State, float]]],
    is_goal: Callable[[State], bool],
    key: Callable[[State], Any] = lambda s: s,
) -> Tuple[Optional[State], float]:
    """
    Returns (goal_state, optimal_cost) with minimal cost (g),
    or (None, inf) if no solution exists.
    'h' must be admissible (never overestimates remaining cost).
    All step-costs must be >= 0 for standard guarantees.
    """
    best_g = {}  # per-iteration table: key(state) -> best g seen

    def search(state: State, g: float, bound: float, path: List[State]):
        f = g + h(state)
        if f > bound:
            return f
        if is_goal(state):
            return (state, g)

        ks = key(state)
        if best_g.get(ks, inf) <= g:
            return inf
        best_g[ks] = g

        # Order successors by optimistic f to improve pruning
        succs = list(expand(state))
        succs.sort(key=lambda ns: g + ns[1] + h(ns[0]))

        path.append(state)
        min_excess = inf
        for (s2, c) in succs:
            if s2 in path:  # simple cycle check; for complex states this is rarely triggered
                continue
            res = search(s2, g + c, bound, path)
            if isinstance(res, tuple):  # found solution
                path.pop()
                return res
            if res < min_excess:
                min_excess = res
        path.pop()
        return min_excess

    bound = h(start)
    path: List[State] = []
    while True:
        best_g.clear()
        res = search(start, 0.0, bound, path)
        if isinstance(res, tuple):
            return res  # (goal_state, optimal_cost)
        if res == inf:
            return (None, inf)
        bound = res
