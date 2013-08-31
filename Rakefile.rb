#!/usr/bin/env ruby

throw "Ruby-2.0 is required" if RUBY_VERSION < "2.0"

require "json"
require "rake/clean"

SRC_PATH = "src"

# Get some environment info and setup
# CLEAN.include(WORKING_SRC)
# CLOBBER.include(OUT_PATH)

desc "Writes i18n data to messages.json files"
task :i18n do
	puts "Write i18n data..."

	localesDir = File.join(SRC_PATH, "_locales")
	i18nKeys = Array.new
	localeData = Hash.new

	# delete old built files
	FileUtils.remove_dir(localesDir, true)

	# create new data
	JSON.parse(File.open("i18n.json").read).each do |i18nKey, value|
		i18nKeys.push(i18nKey)

		value.each do |locale, data|
			localeData[locale] = localeData[locale] || Hash.new
			localeData[locale][i18nKey] = {"message" => data}
		end
	end

	# write files
	localeData.each do |locale, data|
		localeDir = File.join(localesDir, locale)
		FileUtils.mkdir_p(localeDir)

		File.open(File.join(localeDir, "messages.json"), "w") do |f|
			f.write(JSON.generate(data))
		end
	end
end

desc "Rebuild config from settings and other data"
task :rebuildConfig do
	puts "Rebuilding config file..."
	File.open(File.join(SRC_PATH, "config.js"), "w") do |f|
		configChunks = {
			"settings" => JSON.parse(File.open("settings.json").read)
		}

		f.write("CONFIG = " + JSON.generate(configChunks))
	end
end

desc "Run this after you have cloned the repo"
task :default do
	Rake::Task["i18n"].execute
	Rake::Task["rebuildConfig"].execute
end