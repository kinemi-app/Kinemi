---
layout: ../../layouts/Legal.astro
title: Privacy Policy
slug: privacy
kicker: Data protection
description: How Kinemi handles your data. Short version, no tracking, your studio in your browser, accounts in the EU.
---

This policy explains which personal data Kinemi processes, why, and what rights you have under the EU General Data Protection Regulation (GDPR). It covers this website, the studio at `/app/`, and accounts where this copy of Kinemi offers them.

## The short version

- **No tracking.** No analytics, no advertising, no tracking pixels, no third-party cookies. The fonts are served from this site.
- **Your studio lives in your browser.** Renders, chats, folders and settings are stored on your device. Without an account, none of it is sent to us.
- **Accounts are optional where guests are allowed.** If you create one, your studio is saved to your account with our processor Supabase, in {{dataRegion}}.
- **The keys you bring stay with you.** Your Comfy Cloud and OpenRouter keys are stored in your browser only and go straight to the service they belong to.
- **Renders run on compute you choose.** Kinemi itself renders nothing: your browser sends the work to your own ComfyUI or your Comfy Cloud account.

## Who is responsible

The controller under Art. 4 (7) GDPR is:

{{operator}}<br />
{{address}}<br />
Email: {{email}}<br />
Phone: {{phone}}

## Visiting this website

When you open a page, your browser sends technical data that our web host records in server logs: your IP address, the date and time, the page requested, the referring page, your browser and operating system. We need this to deliver the site and to keep it secure, for example to spot attacks.

- **Legal basis:** Art. 6 (1) (f) GDPR, our legitimate interest in a working, secure website.
- **Processor:** {{host}}, which hosts the site on our behalf under a data processing agreement (Art. 28 GDPR).
- **How long:** the logs are deleted after {{logDays}}, unless an incident needs them kept longer.

## The studio without an account

Everything you make in the studio, your renders' details, chats, folders, tags, cast, drafts, settings and the files you import, is stored in your browser on your own device (localStorage and IndexedDB). It is not sent to us, and we can't see it.

You can delete it at any time: in the studio under Settings → Data & privacy → Reset this studio, or by clearing this site's data in your browser. Settings → Data & privacy also lets you export everything as a file. The page [Cookies and storage](/legal/cookies/) lists every entry Kinemi stores.

## Accounts

Where this copy of Kinemi offers accounts and you create one, we process:

- your email address, your name, and your password (stored only as a salted hash),
- sign-in data the account service records: time of sign-in and the IP address used,
- your studio: the same items as above, so it can follow you to every device you sign in on, and the images and clips you import.

**Why and on what basis:** to provide the account and sync your studio, which you ask for when you sign up (Art. 6 (1) (b) GDPR). Sign-in records also protect your account from misuse (Art. 6 (1) (f) GDPR).

**Processor:** Supabase, Inc. runs the account service and the storage for us under a data processing agreement (Art. 28 GDPR). Your account data is stored in {{dataRegion}}. Supabase is a company based in the USA, so access from outside the EU, for example for support, can't be ruled out; such transfers are covered by the EU Standard Contractual Clauses in Supabase's data processing agreement (Art. 46 (2) (c) GDPR). More at [supabase.com/privacy](https://supabase.com/privacy).

**Emails:** we send emails only to run your account: the link to confirm your address, links to reset your password or confirm a new address. They go out through {{emailProvider}} on our behalf (Art. 28 GDPR). We send no newsletters.

**How long:** until you delete your account. Settings → Account → Delete your account removes the account, your studio and your files at once. Copies in our processor's backups disappear as those backups are replaced on their regular cycle.

You need an email address and a password to have an account. Without them, you can still use the studio as a guest wherever guests are allowed.

## The keys you bring

If you save a Comfy Cloud or OpenRouter key in Settings → Providers, it is stored in your browser only: in localStorage, or with “Remember keys” switched off, in sessionStorage until the tab closes. It is never sent to us, never part of an export, and never saved to your account. Your browser sends it only to the service it belongs to, when you use that service.

## Rendering on your own compute

Kinemi builds the ComfyUI workflow for a shot; the render happens on compute you choose.

- **Your own GPU:** your browser talks directly to the ComfyUI address you entered. Prompts, settings and source images go to that machine, not to us.
- **Comfy Cloud:** with your Comfy Cloud key, your browser sends prompts, settings and source images to Comfy Org's Comfy Cloud, which processes them under your account with Comfy Org, under its own terms and privacy policy. Comfy Org is responsible for that processing itself; we don't receive the data.

## The chat

The chat can run on different assistants; you choose in Settings → Providers.

- **Built-in:** runs in your browser. Nothing you type is sent anywhere.
- **OpenRouter:** your messages, the settings of the current shot and a description of Kinemi's tools go from your browser to OpenRouter, Inc. and the model provider it routes to, under your own OpenRouter account and their terms ([openrouter.ai/privacy](https://openrouter.ai/privacy)). They are responsible for that processing; we don't receive the data.
- **Claude Code or Codex:** only when Kinemi runs on your own computer. Your messages go from your browser to the Kinemi server on that computer, which hands them to the command-line tool you installed. That tool sends them to Anthropic or OpenAI under your own account and their terms.

## Cookies and similar technologies

Kinemi only stores what is strictly necessary to provide the service you ask for: your studio, your settings, the keys you saved and, with an account, your sign-in session (§ 25 (2) no. 2 TDDDG). That's why there is no cookie banner. Nothing is used for tracking or advertising. The full list is on [Cookies and storage](/legal/cookies/).

## Your rights

You have the right to:

- **access** the data we hold about you (Art. 15 GDPR),
- have it **corrected** (Art. 16) or **erased** (Art. 17),
- have its processing **restricted** (Art. 18),
- receive it in a portable format (Art. 20): Settings → Data & privacy → Export the studio does this at any time,
- **object** to processing based on our legitimate interests (Art. 21),
- **complain** to a data protection authority (Art. 77), for example the one responsible for us: {{authority}}.

To use any of these rights, write to {{email}}.

There is no automated decision-making or profiling (Art. 22 GDPR).

## Children

Kinemi is not meant for anyone under {{minimumAge}}, and we don't knowingly process their data.

## Changes

We update this policy when Kinemi changes. The date at the top shows the latest version.
