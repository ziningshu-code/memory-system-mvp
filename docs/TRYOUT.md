# First-user try-out

Ask 5–10 developers who are already building a chat app or agent to try one task. This is a proposed recruitment plan, not a claim that users have already tested the project.

1. Give them the README and demo link without explaining the architecture first.
2. Ask what they think the SDK does and whether it fits a problem they already have.
3. Let them install and run the no-key example.
4. If relevant, let them connect their own provider and try a sanitized conversation.
5. Record the first confusing step, time to first successful retrieval, and whether they would use it again.

Use the repository's first-use feedback issue form for voluntary public feedback. Keep private conversations and credentials out of issues. Outreach messages are provided below for the maintainer to send to people they choose; none have been sent automatically.

## Invitation / 邀请文案

I'm testing Topic Memory, a small TypeScript SDK that finds older conversation topics and reopens the original messages for an existing chat model. There's a no-key walkthrough and a runnable real-model example. If you're building a chat app or agent, would you try one conversation and tell me the first point that feels confusing or fails? I'm looking for usability and retrieval feedback, not a Star exchange.

我做了一个 TypeScript 记忆 SDK：从旧对话中找到相关话题，再把当时的原文交给已有的聊天模型。现在有无需 API Key 的演示和可以接入真实模型的例子。如果你正在做聊天应用或 Agent，想请你试一个对话，告诉我第一个让你困惑或失败的地方。我主要想了解它是否好接入、能否找回你需要的信息。

## What to record

| Date | Relevant use case | Install succeeded | First retrieval succeeded | Main obstacle | Would use again |
| --- | --- | --- | --- | --- | --- |

Read repository Traffic as a separate funnel signal. Low traffic suggests investigating discovery; visitors who fail installation suggest onboarding work; successful trials that do not help suggest product/effectiveness work. Stars are a secondary signal and do not establish any of these alone.
