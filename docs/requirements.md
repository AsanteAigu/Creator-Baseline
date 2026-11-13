> Converted from `Social Media Growth Assistant Requirements Document.docx` (the original stays
> the source of truth). Word equations flatten in conversion; in §6 they read
> `r_i = x_i / median_i` and `score = Σ w_i · r_i`.

## Social Media Growth Assistant: Requirements Document

### 1. Purpose of this document

This document explains, in plain language, what the Social Media Growth Assistant will do, what it will not do, and what we need the client to confirm before building starts.

### 2. The problem

Creators with large Instagram accounts (around 400,000 followers) must keep producing content. Today, someone has to read the likes, comments, shares and watch times by hand, work out which posts did well, and guess what to post next. This is slow, and it is easy to miss patterns.

### 3. What the tool does

The tool acts like a social media growth analyst that never sleeps. On a schedule, it will:

- Collect the latest posts and their numbers from Instagram.

- Score each post to show how well it did compared with that creator's normal results.

- Read the comments to understand what the audience is responding to.

- Write a report: what worked, what did not, and a content plan for what to post next.

The client sees the result on a simple website dashboard.

### 4. Who uses it

The client's team logs in to the tool to see the results. Each creator's Instagram account is a Creator account, connected to the tool, and the creator can see their own results because it is their connected account. The creators have agreed to connect. The client chooses the accounts to track: version 1 targets 3 accounts, and more than 10 may follow.

### 5. How it works, step by step

| Step | What happens | Done by |
|---|---|---|
| 1. Schedule | The tool wakes up every 6 hours. | Normal software |
| 2. Collect | It pulls the most recent posts and their numbers through Instagram's official connection. | Normal software |
| 3. Score | Each post gets a performance score (see section 6). | Normal software |
| 4. Understand | The AI reads the comments and the best and worst posts, and describes what the audience likes. | AI |
| 5. Plan | The AI writes the weekly content plan and updates it as new data comes in. | AI |
| 6. Show | Everything appears on the dashboard. | Normal software |

The AI is used only in steps 4 and 5 and kept to a minimum, so running costs stay low. The scoring and everything else is ordinary software, which keeps the tool predictable.

### 6. How a post is scored

Instagram does not publish exact ranking weights. It has said that the signals that matter most are watch time, sends (people sharing a post privately with friends) and likes, each measured against how many people saw the post. We follow that order. The exact weights below are a starting point and will be tuned with the client.

| Signal | Meaning | Starting weight |
|---|---|---|
| Watch time | How much of the video people actually watch | 0.35 |
| Sends | Share of viewers who send the post to a friend | 0.25 |
| Saves | Share of viewers who save the post | 0.20 |
| Likes | Share of viewers who like the post | 0.10 |
| Comments | Share of viewers who comment | 0.10 |

Step 1: use rates, not counts. A post seen by 100,000 people will collect more sends than one seen by 5,000, so raw counts cannot be compared. Each signal is divided by the number of people reached. For example, 1,000 sends on a reach of 100,000 is a 1% send rate, while 500 sends on a reach of 5,000 is a 10% send rate, so the smaller post did far better. Watch time is already a rate: average time watched divided by video length.

Step 2: compare with the creator's usual. Each rate is compared with that creator's own typical rate (the median) over their last 30 or so posts of the same format. For each signal i, we divide the post's rate xi by the creator's usual rate:

ri=ximediani

The final score adds these up using the weights wi from the table above:

score=iwiri

Since the weights add up to 1, a typical post scores 1.0.

| Score | Label | Meaning |
|---|---|---|
| Above 1.5 | Strong | Clearly better than usual |
| 0.9 to 1.5 | Normal | Around the usual level |
| Below 0.9 | Weak | Clearly worse than usual |

The client has confirmed that a score above 1.5 is a good post. The Weak cutoff is set at 0.9 for now. Very large values are capped (for example at 5.0) so one viral post does not distort the picture. All signals count towards the score. Photos have no watch time, so they use the same weights with watch time removed and the rest scaled to add up to 1: sends 0.40, saves 0.30, likes 0.15, comments 0.15.

Worked example. Below are one creator's usual rates and one post's rates, with the "times better than usual" value r for each signal.

| Signal | Usual rate | This post's rate | r (post ÷ usual) | Weight |
|---|---|---|---|---|
| Watch time | 40% | 60% | 1.5 | 0.35 |
| Sends | 2% | 3% | 1.5 | 0.25 |
| Saves | 1.5% | 1.5% | 1.0 | 0.20 |
| Likes | 5% | 6% | 1.2 | 0.10 |
| Comments | 0.4% | 0.2% | 0.5 | 0.10 |

score=0.35(1.5)+0.25(1.5)+0.20(1.0)+0.10(1.2)+0.10(0.5)=1.27

This post did about 1.27 times better than this creator's usual post, so it is Normal, toward the upper end. It was strong on watch time and sends, average on saves, and weak on comments.

The total makes sense because the score is a weighted average of "how many times better than usual", not a sum of counts. It always sits between the lowest and highest r values (here 0.5 and 1.5), and it cannot become huge just because a post had a large audience.

### 7. What the client receives

After each run, the dashboard shows:

- Top and bottom posts, with their scores and labels.

- What is working and what is not, in plain sentences.

- Audience themes from the comments, including overall sentiment (positive, neutral, negative).

- A weekly content plan: a list of suggested post ideas, each with a short reason based on the data, and a content calendar for the week. The plan is updated as new data arrives, not rewritten from scratch.

Comments are used as evidence of what people engage with. They are not treated as instructions, and the tool does not reply to commenters.

### 8. Requirements

What the tool must do

- R1. Connect to an Instagram account through Instagram's official connection, with the account owner's permission.

- R2. Run automatically every 6 hours, on a schedule that can be changed.

- R3. Collect likes, comments, shares, saves, reach and watch time for recent posts of all types (Reels, photos and others).

- R4. Score each post using the method in section 6, with weights and cutoffs that can be changed without rebuilding the tool. Photos use their own weights, without watch time.

- R5. Analyse comment sentiment and common themes.

- R6. Generate a weekly report of what worked and what did not, and a content plan made of a list of post ideas and a content calendar for the week, updated as new data arrives.

- R7. Show the results on a web dashboard and keep past reports for comparison.

- R8. Let the user mark each suggestion as used or not used.

- R9. Let the client's team sign in securely to see their results.

How well it must work

- R10. It is easy to use without training.

- R11. Store only the data it needs and keeps it secure and private.

- R12. Keep running and show a clear message if Instagram's data is unavailable.

- R13. Make clear that content suggestions come from AI and are advice, not guarantees.

- R14. Delete a creator's stored data when they disconnect their account or ask for deletion.

- R15. Turn comments into statistics (sentiment and common themes) and keep those, not the full comments.

### 9. Not included in version 1

- Posting content automatically.

- Replying to comments.

- Platforms other than Instagram (Instagram only for now).

- Predicting exact future views or follower numbers.

- More than 3 accounts in version 1 (more than 10 may follow).

- A model that regulates the weights and cutoffs from data (planned for a later version; the weights are kept as settings so it can be added).

### 10. Assumptions and risks

- Account type. The accounts are Instagram Creator accounts, which give full analytics. The creators have agreed to connect their accounts.

- Instagram limits. Instagram controls what data is available and how often. Running every 6 hours must be checked against Instagram's current limits before final planning.

- New posts. A post's numbers keep growing for a while after it goes up, so new posts are given time before they are judged. Every recent post is scored on each 6-hour run, using its latest numbers. A post younger than 1 day is not scored yet and shows as too early to score.

- Privacy rules. The client is in the UK and has confirmed that UK data protection rules must be followed. They apply to the comments the tool reads, and Meta's platform terms apply to the Instagram data. Comments are turned into statistics so that less personal data is kept.

- Scoring weights are not official. Instagram does not publish exact weights. We will check that the score matches real results on the client's past posts, and adjust.

- AI can be wrong. Suggestions should be reviewed by a person before they are used.

- Budget. The budget is small, so running costs are kept as low as possible.

- Deadline and upkeep. The deadline is Sunday (15 November 2026), and the developer maintains the tool after launch. Version 1 targets 3 accounts and a basic dashboard.
