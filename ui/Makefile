BUILD_DIR = ./_netlify
UI = .
UI_PACKAGES = ${UI}/packages

netlify:
	@echo Building Netlify website

	make netlify-clean
	make netlify-build-modules
	make netlify-build-storybooks
	make netlify-collect-storybooks

netlify-clean:
	@echo Cleanup
	rm -rf ${BUILD_DIR}
	
netlify-build-modules:
	@echo Build all modules
	(cd ${UI_PACKAGES}/atlasmap-core; yarn build:module)
	
netlify-build-storybooks:
	@echo Build all storybooks
	(cd ${UI_PACKAGES}/atlasmap; yarn prebuild; yarn build:storybook)

netlify-collect-storybooks:
	@echo Collect built storybooks
	cp -a ${UI_PACKAGES}/atlasmap/storybook-static ${BUILD_DIR}
