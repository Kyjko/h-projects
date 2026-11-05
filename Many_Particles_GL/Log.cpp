#include "Log.h"

std::string GetDateInString() {
	auto tNow = std::chrono::system_clock::now();
	auto Now = std::chrono::system_clock::to_time_t(tNow);
	std::stringstream ss;
	ss << std::put_time(std::localtime(&Now), "%Y-%m-%d %X");

	return ss.str();;
}

void Log(const char* s, LogEnums::MSG_TYPES type) {

	fprintf(stdout, "%s %s %s\n", GetDateInString().c_str(), 
		type == LogEnums::MSG_TYPES::INFO ? "[~]" : type == LogEnums::MSG_TYPES::WARN ? "[-]"
		 : type == LogEnums::MSG_TYPES::ERROR ? "[!]" : type == LogEnums::MSG_TYPES::FATAL 
		? "[!!]" : "[]", s);
}