#!/usr/bin/env python3
"""完成HTMLを渡す場合と軽量JSONを渡す場合の概算トークン差を表示する。"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

def token_range(chars: int, low_ratio: float, high_ratio: float) -> tuple[int, int]:
    # chars/token が大きいほどトークン数は少ない。
    return round(chars / high_ratio), round(chars / low_ratio)

def main() -> None:
    p=argparse.ArgumentParser()
    p.add_argument('--html', type=Path)
    p.add_argument('--payload', type=Path, default=PROJECT_ROOT/'cache'/'ai_analysis_payload.json')
    args=p.parse_args()
    if args.html is None:
        report=json.loads((PROJECT_ROOT/'cache'/'report_data.json').read_text(encoding='utf-8'))
        args.html=PROJECT_ROOT/'output'/report['output_filename']
    html_chars=len(args.html.read_text(encoding='utf-8'))
    payload_chars=len(args.payload.read_text(encoding='utf-8'))
    # Base64主体HTMLは1.2〜2.0文字/token、日英混在JSONは1.5〜3.0文字/tokenの幅で概算。
    html_range=token_range(html_chars,1.2,2.0)
    payload_range=token_range(payload_chars,1.5,3.0)
    result={
        'html': {'path': str(args.html), 'chars': html_chars, 'estimated_tokens': {'low':html_range[0],'high':html_range[1]}},
        'ai_payload': {'path': str(args.payload), 'chars': payload_chars, 'estimated_tokens': {'low':payload_range[0],'high':payload_range[1]}},
        'estimated_reduction_percent': {
            'conservative': round((1-payload_range[1]/html_range[0])*100,1),
            'optimistic': round((1-payload_range[0]/html_range[1])*100,1),
        },
        'note': 'モデルのトークナイザーで変わる概算。CSVはPythonで読み、会話本文へ展開しない前提。'
    }
    out=PROJECT_ROOT/'cache'/'token_savings_estimate.json'
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
