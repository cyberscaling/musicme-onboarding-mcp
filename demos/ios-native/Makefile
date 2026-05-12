.PHONY: project build test clean lint

XCODEGEN := $(shell command -v xcodegen 2>/dev/null)
SIMULATOR ?= iPhone 16
SIMULATOR_OS ?= 18.5
DESTINATION := platform=iOS Simulator,name=$(SIMULATOR),OS=$(SIMULATOR_OS)

project:
ifndef XCODEGEN
	$(error xcodegen not installed. brew install xcodegen)
endif
	xcodegen generate

build: project
	xcodebuild -scheme SASDemoiOS -destination '$(DESTINATION)' build

test: project
	xcodebuild -scheme SASCoreTests -destination '$(DESTINATION)' test

clean:
	rm -rf SASDemoiOS.xcodeproj DerivedData .build

lint:
	@echo "no lint configured"
