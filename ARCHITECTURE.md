# FCA Chatbot — Architecture Diagram

```mermaid
flowchart LR
    User([User]) -->|types question| Chat[AI Chat Assistant]
    Chat -->|safety check| Guard{Input Filter}
    Guard -->|blocked| Chat
    Guard -->|approved| AI[Gemini AI Model]
    AI -->|searches| FCA[(FCA Data Portal)]
    FCA -->|live data| AI
    AI -->|streamed response| Chat
    Chat -->|answer + document links| User
```
