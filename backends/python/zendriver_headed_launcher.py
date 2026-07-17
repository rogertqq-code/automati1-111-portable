# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "zendriver",
# ]
# ///
import sys
import json
import asyncio
import logging

import zendriver as zd

async def main():
    try:
        # Read config from stdin line
        input_data = sys.stdin.readline()
        config = json.loads(input_data) if input_data.strip() else {}
        
        proxy_str = None
        if config.get("proxy"):
            p = config["proxy"]
            if p.get("server"):
                proxy_str = p["server"]
        
        browser_args = [
            "--disable-features=PasswordCheckup",
            "--password-store=basic",
            "--test-type"
        ]
        if proxy_str:
            browser_args.append(f"--proxy-server={proxy_str}")
            
        user_agent = config.get("userAgent")
        if user_agent:
            browser_args.append(f"--user-agent={user_agent}")
            
        browser = await zd.start(
            headless=False,
            browser_args=browser_args
        )
        
        result = {
            "ws_endpoint": browser.websocket_url,
            "pid": browser._process_pid
        }
        
        print(json.dumps(result))
        sys.stdout.flush()
        
        while True:
            await asyncio.sleep(1)
            
    except Exception as e:
        logging.error(f"Error starting zendriver headed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
