To run the solution, first configure the transact-mcp server: 

(reference: [https://repo.ghany.fyi/OpenCorp/Transact-MCP/wiki/Configuration])

Most important config files for transact-mcp:

- ~/.config/transact-mcp/.env
	- Create the file if it doesn't exist, paste the contents of .env.temp into it
	- Change TAFJ_HOME to the TAFJ home directory of the Transact environment!
	- Change TRANSACT_MCP_USER and TRANSACT_MCP_PASSWORD to the credentials of a valid Transact user! (it will be the inputter user in the OFS messages)
	- Change TRANSACT_MCP_AUTHORIZER_USER and TRANSACT_MCP_AUTHORIZER_PASSWORD to different valid user (it will be used as the authorizer by the transact-mcp (only necessary when intending to actually authorize records using the solution

- ~/.config/transact-mcp/config.toml
	- Create the file if it doesn't exist, paste the contents of config-temp.toml into it
	- In the [ofs] section, input the same inputter user details as in .env + company code
	- In the [ofs.authorizer] section, input the authorizer user + company code
	- Change the "program" and "working_dir" to match the environment

Verify local installations:

- Install Nodejs (https://nodejs.org/en/download) if not installed already
- Install Copilot CLI with `npm install -g @github/copilot` if not installed already
- Install Python
(the launcher script checks installations)

Copilot config files (in ~/.copilot) to be created/altered:
	- mcp-config.json: use the contents of "mcp-config-temp.json" file (with changing the absolute path in the word-mcp-server section to match the local installation of the solution)
	- permissions-config.json: use the contents of "permissions-config-temp.json" (change the location path at the beginning of the file)
	
- The Copilot CLI needs authentication!

Launch the solution with start_transact_assistant_browser.bat
(it is also possible to launch the 2 components of the solution separately, the transact-mcp.exe is in ./Transact-MCP-main/transact-mcp/bin, for launching the browser, go to ./Copilot/transact-copilot-browser and run `npm start`

Known issues:
	- The transact-mcp server is prone to timeouts, either by a massive enquiry, or at launching its child process at the beginning (tRun tSS GCS), the launcher script will give notification whenever it happens - in that case, just relaunch it.

