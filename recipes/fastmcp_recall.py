"""Optional, documentation-checked FastMCP recipe. No provider/model invocation."""
import argparse
import asyncio
from fastmcp import Client
from fastmcp.client.auth import OAuth


async def main():
    async with Client("https://awase.dev/stem", auth=OAuth(scopes=["stem"], client_name="STEM cookbook read-only recipe")) as client:
        tools = await client.list_tools()
        if not any(tool.name == "recall" for tool in tools):
            raise RuntimeError("The recall tool is unavailable on this connection.")
        result = await client.call_tool("recall", {"query": "stem-cookbook synthetic Project Lantern", "limit": 3})
        # Leave text, structured content, tokens and full SDK objects out of logs.
        print("Read-only recall completed; inspect results within your application. No contents were logged.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Explicitly connect through browser OAuth and run one read-only synthetic-topic recall.")
    parser.add_argument("--connect", action="store_true", required=True)
    parser.parse_args()
    asyncio.run(main())
