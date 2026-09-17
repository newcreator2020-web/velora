"use client";

import { useEffect } from "react";

export function SectionRevealObserver() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const reduceMotion =
      typeof window.matchMedia !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const elements = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));

    if (reduceMotion) {
      for (const el of elements) el.classList.add("reveal--in");
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      for (const el of elements) el.classList.add("reveal--in");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal--in");
            observer.unobserve(entry.target);
          }
        }
      },
      { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    for (const el of elements) {
      if (el.classList.contains("reveal--in")) continue;
      observer.observe(el);
    }

    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            const news = document.querySelectorAll<HTMLElement>(".reveal:not(.reveal--in)");
            for (const n of Array.from(news)) observer.observe(n);
          })
        : null;
    if (mo) mo.observe(document.documentElement, { subtree: true, childList: true });

    return () => {
      observer.disconnect();
      if (mo) mo.disconnect();
    };
  }, []);

  return null;
}
