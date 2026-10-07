"""Conservative lexical observations, never an inference of confidence or ability."""

import re


def lexical_metrics(text):
    matches = list(re.finditer(r"\b(?:u+m+|u+h+|e+rm+|e+r+|h+m+|m{2,}|a+h{2,})\b", text, re.I))
    return {
        "filler_count": len(matches),
        "filler_events": [
            {"text": m.group(), "start_char": m.start(), "end_char": m.end()} for m in matches
        ],
        "hedge_count": len(
            re.findall(
                r"\b(?:maybe|perhaps|i think|i guess|i am not sure|i'm not sure)\b", text, re.I
            )
        ),
        "restart_count": len(re.findall(r"\b(?:i mean|sorry|let me start again)\b", text, re.I)),
        "ambiguous_markers": len(re.findall(r"\b(?:like|you know|well|so)\b", text, re.I)),
    }
