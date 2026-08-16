#!/usr/bin/env python3
"""Winery — Star1's backend orchestration layer.

Runs the research pipeline:
  Question → Plan → Search → Fetch → Synthesize → Output

Designed to run inside a GitHub Actions ephemeral runner.
"""

import os
import sys
import json
import re
import time
from typing import List, Dict, Optional

from openai import OpenAI

from prompts import STAR1_SYSTEM_PROMPT, RESEARCH_PLAN_PROMPT, SYNTHESIS_PROMPT
from tools import search_web, fetch_page, classify_source, is_valid_source
from models import ResearchReport, Source, Finding, Comparison, ResearchJob


# ─── Configuration ───

HF_TOKEN = os.environ.get("HF_TOKEN", "")
RESEARCH_QUESTION = os.environ.get("RESEARCH_QUESTION", "")
KIMI_MODEL = os.environ.get("KIMI_MODEL", "moonshotai/Kimi-K3:together")
MAX_SEARCHES = int(os.environ.get("MAX_SEARCHES", "6"))
MAX_FETCHES = int(os.environ.get("MAX_FETCHES", "8"))
MAX_CONTENT_LENGTH = 8000  # Max chars per page to send to K3

if not HF_TOKEN:
    print("[Winery] ERROR: HF_TOKEN not set.", file=sys.stderr)
    sys.exit(1)

if not RESEARCH_QUESTION:
    print("[Winery] ERROR: RESEARCH_QUESTION not set.", file=sys.stderr)
    sys.exit(1)


# ─── K3 Client ───

client = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=HF_TOKEN,
)


def call_k3(messages: List[Dict], temperature: float = 0.3, max_tokens: int = 4000) -> str:
    """Call Kimi K3 via Hugging Face router."""
    try:
        completion = client.chat.completions.create(
            model=KIMI_MODEL,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return completion.choices[0].message.content
    except Exception as e:
        print(f"[Winery] K3 API error: {e}", file=sys.stderr)
        raise


def parse_json_from_response(text: str) -> Optional[Dict]:
    """Extract JSON from model response, handling markdown fences."""
    # Try to find JSON in markdown code fences
    patterns = [
        r"```json\s*(.*?)```",
        r"```\s*(.*?)```",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except json.JSONDecodeError:
                continue

    # Try the whole text
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    return None


# ─── Research Pipeline ───

def generate_research_plan(question: str) -> List[str]:
    """Ask K3 to generate search queries for the research plan."""
    print("[Winery] Generating research plan...")

    prompt = RESEARCH_PLAN_PROMPT.format(question=question)

    messages = [
        {"role": "system", "content": STAR1_SYSTEM_PROMPT},
        {"role": "user", "content": prompt}
    ]

    response = call_k3(messages, temperature=0.4, max_tokens=800)

    plan = parse_json_from_response(response)
    if plan and isinstance(plan, list):
        queries = [q for q in plan if isinstance(q, str) and len(q) > 3]
        print(f"[Winery] Plan: {len(queries)} queries")
        return queries[:MAX_SEARCHES]

    # Fallback: use the question itself
    print("[Winery] Warning: Could not parse research plan. Using fallback.")
    return [question]


def execute_searches(queries: List[str]) -> List[Source]:
    """Execute web searches and collect results."""
    print("[Winery] Searching sources...")

    all_results = []
    seen_urls = set()

    for query in queries:
        print(f"[Winery] Search: {query}")
        try:
            results = search_web(query, max_results=5)
            for r in results:
                if r.url in seen_urls:
                    continue
                if not is_valid_source(r.url):
                    continue
                seen_urls.add(r.url)
                all_results.append(r)
            time.sleep(1)  # Be polite to search engine
        except Exception as e:
            print(f"[Winery] Search failed for '{query}': {e}")

    # Convert to Source objects
    sources = []
    for r in all_results:
        src_type = classify_source(r.url, r.title)
        sources.append(Source(
            title=r.title,
            url=r.url,
            type=src_type,
            snippet=r.snippet
        ))

    print(f"[Winery] Found {len(sources)} unique sources")
    return sources


def fetch_source_content(sources: List[Source]) -> List[Source]:
    """Fetch full text content from the most promising sources."""
    print("[Winery] Fetching source content...")

    # Prioritize: fetch primary sources first, then secondary
    prioritized = sorted(sources, key=lambda s: 0 if s.type == "primary" else 1)

    fetched = 0
    for source in prioritized:
        if fetched >= MAX_FETCHES:
            break

        print(f"[Winery] Fetching: {source.url[:80]}...")
        page = fetch_page(source.url)

        if page and page.text and len(page.text) > 200:
            # Truncate content for the LLM
            text = page.text[:MAX_CONTENT_LENGTH]
            if len(page.text) > MAX_CONTENT_LENGTH:
                text += "\n...[content truncated for analysis]"

            source.fetched_text = text
            source.title = page.title or source.title
            fetched += 1
            time.sleep(0.5)  # Be polite
        else:
            print(f"[Winery] Skipped: no useful content")

    print(f"[Winery] Fetched content from {fetched} sources")
    return sources


def synthesize_report(question: str, sources: List[Source]) -> ResearchReport:
    """Ask K3 to synthesize the gathered evidence into a research report."""
    print("[Winery] Synthesizing findings...")

    # Build sources text for the prompt
    sources_text = []
    for i, s in enumerate(sources, 1):
        entry = f"Source {i}: {s.title} ({s.type})\nURL: {s.url}\n"
        if s.fetched_text:
            entry += f"Content: {s.fetched_text[:1500]}\n"
        elif s.snippet:
            entry += f"Snippet: {s.snippet}\n"
        sources_text.append(entry)

    sources_block = "\n---\n".join(sources_text)

    prompt = SYNTHESIS_PROMPT.format(
        question=question,
        sources_text=sources_block
    )

    messages = [
        {"role": "system", "content": STAR1_SYSTEM_PROMPT},
        {"role": "user", "content": prompt}
    ]

    response = call_k3(messages, temperature=0.3, max_tokens=4000)

    # Parse the JSON report
    report_data = parse_json_from_response(response)

    if not report_data:
        print("[Winery] Warning: Could not parse structured report. Building fallback.")
        return build_fallback_report(question, sources, response)

    # Build ResearchReport from parsed data
    findings = []
    for f in report_data.get("key_findings", []):
        if isinstance(f, dict):
            findings.append(Finding(
                title=f.get("title", "Finding"),
                content=f.get("content", "")
            ))

    comparison = None
    comp_data = report_data.get("comparison")
    if comp_data and isinstance(comp_data, dict):
        comparison = Comparison(
            headers=comp_data.get("headers", []),
            rows=comp_data.get("rows", [])
        )

    # Map sources from report to our Source objects, preserving URLs
    report_sources = []
    for s in report_data.get("sources", []):
        if isinstance(s, dict):
            report_sources.append(Source(
                title=s.get("title", "Unknown source"),
                url=s.get("url", ""),
                type=s.get("type", "secondary")
            ))

    # If K3 didn't return sources, use our gathered ones
    if not report_sources:
        report_sources = [s for s in sources if s.url]

    return ResearchReport(
        title=report_data.get("title", "Research Report"),
        executive_summary=report_data.get("executive_summary", ""),
        key_findings=findings,
        comparison=comparison,
        evidence_assessment=report_data.get("evidence_assessment", ""),
        confidence_notes=report_data.get("confidence_notes", ""),
        sources=report_sources,
        question=question
    )


def build_fallback_report(question: str, sources: List[Source], raw_response: str) -> ResearchReport:
    """Build a basic report when JSON parsing fails."""
    return ResearchReport(
        title=f"Research: {question[:60]}",
        executive_summary="Star1 completed the research but encountered a formatting issue. The raw analysis is preserved below.",
        key_findings=[
            Finding(title="Analysis", content=raw_response[:2000])
        ],
        evidence_assessment="See raw analysis above.",
        confidence_notes="Structured synthesis encountered an error. Evidence was gathered but final formatting failed.",
        sources=[s for s in sources if s.url]
    )


# ─── Main ───

def main():
    print("=" * 50)
    print("Star1 / Winery")
    print(f"Question: {RESEARCH_QUESTION}")
    print(f"Model: {KIMI_MODEL}")
    print("=" * 50)

    job = ResearchJob(question=RESEARCH_QUESTION)

    try:
        # Step 1: Plan
        job.status = "planning"
        plan = generate_research_plan(RESEARCH_QUESTION)
        job.plan = plan

        # Step 2: Search
        job.status = "researching"
        sources = execute_searches(plan)
        job.sources = sources

        if len(sources) < 2:
            print("[Winery] Warning: Very few sources found. Research may be limited.")

        # Step 3: Fetch
        sources = fetch_source_content(sources)
        job.sources = sources

        # Step 4: Synthesize
        job.status = "synthesizing"
        report = synthesize_report(RESEARCH_QUESTION, sources)

        # Step 5: Output
        job.status = "complete"

        output = {
            "job": {
                "question": job.question,
                "plan": job.plan,
                "status": job.status,
                "sources_count": len(job.sources),
                "fetched_count": len([s for s in job.sources if s.fetched_text])
            },
            "report": report.to_dict()
        }

        # Save result
        output_path = os.environ.get("RESULT_PATH", "result.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

        print(f"\n[Winery] Research complete. Saved to {output_path}")
        print(f"[Winery] Sources: {len(report.sources)} | Findings: {len(report.key_findings)}")

        # Also print a summary for GitHub Actions logs
        print("\n--- EXECUTIVE SUMMARY ---")
        print(report.executive_summary)
        print("---")

    except Exception as e:
        job.status = "failed"
        job.error = str(e)

        error_output = {
            "job": {
                "question": job.question,
                "status": "failed",
                "error": job.error
            },
            "report": None
        }

        output_path = os.environ.get("RESULT_PATH", "result.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(error_output, f, indent=2)

        print(f"\n[Winery] Research failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
