# Optional framework recipes

The dependency-free clients and local OAuth fixture tests in the parent directory are verified separately. These two recipes follow official framework documentation checked on 2026-10-25. They have **not** been executed against a real STEM account or model provider as part of this baseline. Install optional dependencies in a separate virtual environment and pin the resolved versions in your application. Python **3.11+** is appropriate for these current frameworks. No packages are needed for the core Node/Python examples.

## FastMCP: let a maintained client own OAuth

```sh
python3 -m venv .venv
.venv/bin/python -m pip install 'fastmcp>=3,<4'
.venv/bin/python recipes/fastmcp_recall.py --connect
```

This opens an interactive OAuth flow and performs only a bounded read of a synthetic topic. Use a dedicated test account: an actual recall can return weak candidates from that account. The script prints only counts, never memory text or tokens. It leaves connection management to the SDK and does not claim to revoke a grant. No automatic saving is requested. The SDK's current OAuth helper defaults to memory-only token storage; if your production application persists tokens, use reviewed encrypted storage and keep each user's grants separate.

[FastMCP's official OAuth guide](https://gofastmcp.com/clients/auth/oauth) documents PKCE, `OAuth(scopes=...)`, in-memory default storage and CIMD/DCR behavior. Check that your installed version retains these properties before deployment.

## LangChain: expose only the tools the current task needs

Install `langchain[mcp]>=1.4,<2` plus your chosen provider's integration in the same virtual environment. The current `langchain.mcp` interface is **beta**. This factory does not invoke a model or spend API credits:

```python
from fastmcp import Client
from fastmcp.client.auth import OAuth
from langchain.agents import create_agent
from langchain.mcp import MCPAdapter

async def make_recall_agent(configured_model):
    # configured_model is supplied by your application; never put provider keys here.
    client = Client("https://awase.dev/stem", auth=OAuth(scopes=["stem"]))
    async with MCPAdapter(client) as adapter:
        discovered = await adapter.list_tools()
        recall_tools = [tool for tool in discovered if tool.name == "recall"]
        if len(recall_tools) != 1:
            raise RuntimeError("Expected one recall tool; inspect your adapter's naming rules.")
        return create_agent(configured_model, recall_tools)
```

Call the returned agent only after configuring your provider and deciding what synthetic prompt/data to send. A full save workflow needs a separate explicit-user-save approval gate; do not expose write tools indiscriminately or let retrieved text change your application instructions. This recipe intentionally does not choose a model, load a provider key, call an LLM, or report a success rate.

[LangChain's official MCP documentation](https://docs.langchain.com/oss/python/langchain/mcp) documents `MCPAdapter`, wrapping a prebuilt FastMCP client, and passing discovered tools to `create_agent`. Its beta API can change; the recipe is documentation-checked, not a tested compatibility badge.
