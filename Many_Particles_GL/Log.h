#pragma once
#include <iostream>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <cstdarg>

std::string GetDateInString();

namespace LogEnums {
	enum MSG_TYPES {
		INFO,
		WARN,
		ERROR,
		FATAL
	};
}

void Log(const char* s, LogEnums::MSG_TYPES type);


